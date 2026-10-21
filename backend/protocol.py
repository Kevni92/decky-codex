"""Bounded, bidirectional JSONL transport; server requests never block its reader."""
import asyncio
import json
import os
import signal


class ProtocolError(RuntimeError):
    pass


class CodexClient:
    def __init__(self, command, env, cwd, handler):
        self.command, self.env, self.cwd, self.handler = command, env, cwd, handler
        self.process = None
        self.pending = {}
        self.counter = 0
        self.tasks = set()
        self.reader = None
        self.stderr = None
        self.write_lock = asyncio.Lock()
        self.error = ""

    async def start(self):
        self.process = await asyncio.create_subprocess_exec(
            *self.command, cwd=str(self.cwd), env=self.env,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE, limit=2 * 1024 * 1024,
            start_new_session=True)
        self.reader = asyncio.create_task(self._read())
        self.stderr = asyncio.create_task(self._drain_stderr())
        await self.request("initialize", {
            "clientInfo": {"name": "decky_codex", "title": "Decky Codex", "version": "0.1.0"},
            "capabilities": {"experimentalApi": True}})
        await self.send({"method": "initialized"})

    async def send(self, message):
        if not self.process or self.process.returncode is not None:
            raise ProtocolError("Codex-Verbindung beendet. Chat erneut öffnen.")
        data = json.dumps(message, ensure_ascii=False).encode() + b"\n"
        if len(data) > 1024 * 1024:
            raise ProtocolError("Nachricht ist zu groß.")
        async with self.write_lock:
            self.process.stdin.write(data)
            await self.process.stdin.drain()

    async def request(self, method, params=None, timeout=30):
        self.counter += 1
        rid = self.counter
        future = asyncio.get_running_loop().create_future()
        self.pending[rid] = future
        try:
            await self.send({"id": rid, "method": method, "params": params or {}})
            return await asyncio.wait_for(future, timeout)
        finally:
            self.pending.pop(rid, None)

    async def _handle(self, message):
        try:
            result = await self.handler(message)
            if "id" in message:
                await self.send({"id": message["id"], "result": result})
        except asyncio.CancelledError:
            raise
        except Exception:
            if "id" in message:
                await self.send({"id": message["id"], "error": {
                    "code": -32000, "message": "Anfrage abgelehnt oder nicht verfügbar."}})

    async def _read(self):
        try:
            while True:
                line = await self.process.stdout.readline()
                if not line:
                    raise ProtocolError("Codex-Prozess wurde beendet.")
                if len(line) > 1024 * 1024:
                    raise ProtocolError("Zu große Codex-Nachricht.")
                message = json.loads(line)
                if "method" not in message and "id" in message:
                    future = self.pending.get(message["id"])
                    if future and not future.done():
                        if "error" in message:
                            future.set_exception(ProtocolError(str(message["error"].get("message", "Codex-Fehler"))[:800]))
                        else:
                            future.set_result(message.get("result", {}))
                else:
                    task = asyncio.create_task(self._handle(message))
                    self.tasks.add(task)
                    task.add_done_callback(self.tasks.discard)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            self.error = str(exc)[:800]
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(ProtocolError(self.error))
            try:
                await self.handler({"method": "transport/closed", "params": {"message": self.error}})
            except Exception:
                pass

    async def _drain_stderr(self):
        # Drain without forwarding credentials, raw logs or prompts into the chat.
        while await self.process.stderr.read(4096):
            pass

    async def close(self):
        for task in list(self.tasks):
            task.cancel()
        if self.process and self.process.returncode is None:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
                await asyncio.wait_for(self.process.wait(), 4)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await self.process.wait()
        for task in (self.reader, self.stderr):
            if task:
                task.cancel()
