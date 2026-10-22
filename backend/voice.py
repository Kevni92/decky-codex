"""Explicit, leased microphone capture and local Whisper dictation. No cloud calls."""
import asyncio
import hashlib
import json
import os
import shutil
import signal
import struct
import tempfile
import time
import uuid
from pathlib import Path

RATE = 16000
MAX_SECONDS = 30
MAX_BYTES = RATE * 2 * MAX_SECONDS


async def stop_process(process):
    if process and process.returncode is None:
        try:
            process.send_signal(signal.SIGINT)
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), 2)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()


class Dictation:
    def __init__(self, root, data, env):
        self.root, self.data, self.env = Path(root), Path(data), env
        self.lock = asyncio.Lock()
        self.token = None
        self.state = "idle"
        self.error = self.text = ""
        self.audio = bytearray()
        self.capture = self.decoder = None
        self.reader = self.worker = self.watchdog = None
        self.seen = self.started = 0

    async def verify(self):
        manifest = self.root / "runtime/voice-installed.json"
        if not manifest.is_file():
            raise ValueError("Sprachmodell fehlt. Bitte die aktuelle Release-ZIP installieren.")
        files = json.loads(manifest.read_text())["files"]
        for name in ("voice/whisper-cli", "voice/model.bin"):
            path = self.root / "bin" / name
            def digest():
                with path.open("rb") as stream:
                    return hashlib.file_digest(stream, "sha256").hexdigest()
            if await asyncio.to_thread(digest) != files.get(name):
                raise ValueError("Sprachmodell-Prüfsumme falsch. Release-ZIP erneut installieren.")

    def check(self, params):
        if not self.token or params.get("token") != self.token:
            raise ValueError("Sprachaufnahme ist nicht mehr aktuell.")
        self.seen = time.monotonic()

    async def start(self, params):
        async with self.lock:
            if self.token:
                raise ValueError("Es läuft bereits eine Sprachaufnahme.")
            await self.verify()
            recorder = shutil.which("pw-record", path=self.env()["PATH"])
            if not recorder:
                raise ValueError("PipeWire-Aufnahme fehlt (pw-record). Mikrofon bitte in den Steam-Audioeinstellungen prüfen.")
            self.audio.clear()
            self.error = self.text = ""
            self.capture = await asyncio.create_subprocess_exec(
                recorder, "--raw", "--rate=16000", "--channels=1", "--format=s16", "-",
                env=self.env(), stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            self.token = uuid.uuid4().hex
            self.started = self.seen = time.monotonic()
            self.state = "recording"
            self.reader = asyncio.create_task(self.read_audio())
            self.watchdog = asyncio.create_task(self.watch())
            return {"token": self.token, "state": self.state, "maxSeconds": MAX_SECONDS}

    async def read_audio(self):
        try:
            while self.state == "recording":
                block = await self.capture.stdout.read(8192)
                if not block:
                    if self.state == "recording":
                        self.state = "failed"
                        self.error = "Mikrofon konnte nicht aufgenommen werden. Standard-Eingabegerät in Steam prüfen."
                    return
                remaining = MAX_BYTES - len(self.audio)
                self.audio.extend(block[:remaining])
                if len(self.audio) >= MAX_BYTES:
                    self.state = "recorded"
                    await stop_process(self.capture)
                    return
        except (OSError, asyncio.CancelledError):
            return

    async def watch(self):
        try:
            while self.token:
                await asyncio.sleep(.5)
                if time.monotonic() - self.seen > 8:
                    await self.cancel({"token": self.token})
                    return
                if self.state == "recording" and time.monotonic() - self.started >= MAX_SECONDS:
                    self.state = "recorded"
                    await stop_process(self.capture)
        except asyncio.CancelledError:
            pass

    async def status(self, params):
        async with self.lock:
            self.check(params)
            return {"state": self.state, "seconds": min(MAX_SECONDS, int(time.monotonic() - self.started)),
                    "text": self.text if self.state == "done" else "", "error": self.error}

    async def finish(self, params):
        async with self.lock:
            self.check(params)
            if self.state in ("recording", "recorded"):
                self.state = "transcribing"
                self.worker = asyncio.create_task(self.transcribe())
            return {"state": self.state}

    async def transcribe(self):
        try:
            await stop_process(self.capture)
            if self.reader:
                await self.reader
            pcm = bytes(self.audio[:len(self.audio) // 2 * 2])
            self.audio.clear()
            if len(pcm) < RATE // 2 or max((abs(v[0]) for v in struct.iter_unpack("<h", pcm)), default=0) < 200:
                raise ValueError("Keine Sprache erkannt. Bitte näher am Mikrofon sprechen und erneut aufnehmen.")
            with tempfile.TemporaryDirectory(prefix="dictation-", dir=self.data) as temporary:
                folder = Path(temporary)
                audio, output = folder / "input.wav", folder / "transcript"
                header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(pcm), b"WAVE", b"fmt ", 16, 1, 1, RATE, RATE * 2, 2, 16, b"data", len(pcm))
                fd = os.open(audio, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(header)
                    stream.write(pcm)
                del pcm
                self.decoder = await asyncio.create_subprocess_exec(
                    str(self.root / "bin/voice/whisper-cli"), "-m", str(self.root / "bin/voice/model.bin"),
                    "-f", str(audio), "-l", "de", "-t", "4", "-ng", "-nt", "-otxt", "-of", str(output),
                    env=self.env(), stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                await asyncio.wait_for(self.decoder.wait(), 90)
                if self.decoder.returncode or not output.with_suffix(".txt").is_file():
                    raise ValueError("Lokale Spracherkennung fehlgeschlagen. Bitte erneut versuchen.")
                self.text = output.with_suffix(".txt").read_text(encoding="utf-8")[:16000].strip()
                if not self.text:
                    raise ValueError("Keine Sprache erkannt. Bitte erneut aufnehmen.")
                self.state = "done"
        except asyncio.CancelledError:
            await stop_process(self.decoder)
            raise
        except (ValueError, OSError, asyncio.TimeoutError) as exc:
            await stop_process(self.decoder)
            self.error = str(exc) if isinstance(exc, ValueError) else "Spracherkennung fehlgeschlagen oder Zeitlimit erreicht."
            self.state = "failed"
        finally:
            self.audio.clear()

    async def cancel(self, params):
        async with self.lock:
            if not self.token or params.get("token") != self.token:
                return {}  # Idempotent; an old view cannot cancel a new recording.
            self.token = None
            self.state = "idle"
            tasks = [t for t in (self.reader, self.worker, self.watchdog) if t and t is not asyncio.current_task()]
            for task in tasks:
                task.cancel()
            await stop_process(self.capture)
            await stop_process(self.decoder)
            await asyncio.gather(*tasks, return_exceptions=True)
            self.audio.clear()
            self.text = self.error = ""
            return {}

    async def close(self):
        await self.cancel({"token": self.token})
