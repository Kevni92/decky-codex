"""No microphones or cloud credentials: real subprocess lifecycle with synthetic PCM."""
import asyncio
import hashlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.voice import Dictation, MAX_BYTES

ROOT = Path(__file__).resolve().parents[1]


class VoiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'data').mkdir()
        (self.root / 'bin/voice').mkdir(parents=True)
        self.voice = Dictation(self.root, self.root / 'data', lambda: {**os.environ, 'PATH': '/usr/bin:/bin'})
        self.recorder = self.root / 'recorder'
        self.recorder.write_text('#!' + sys.executable + '\nimport sys,time\nwhile True:\n sys.stdout.buffer.write(b"\\x00\\x10" * 1600);sys.stdout.buffer.flush();time.sleep(.02)\n')
        self.recorder.chmod(0o755)
        decoder = self.root / 'bin/voice/whisper-cli'
        decoder.write_text('#!' + sys.executable + '\nimport sys,pathlib,struct\na=sys.argv\np=pathlib.Path(a[a.index("-f")+1]);d=p.read_bytes();assert d[:4]==b"RIFF";assert struct.unpack_from("<I",d,24)[0]==16000\npathlib.Path(a[a.index("-of")+1]+".txt").write_text("Installiere Programm X",encoding="utf-8")\n')
        decoder.chmod(0o755)
        (self.root / 'bin/voice/model.bin').write_bytes(b'test model')
        (self.root / 'runtime').mkdir()
        files = {str(p.relative_to(self.root / 'bin')): hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.root / 'bin/voice').iterdir()}
        (self.root / 'runtime/voice-installed.json').write_text(json.dumps({'files': files}))
        self.which = patch('backend.voice.shutil.which', return_value=str(self.recorder))
        self.which.start()

    async def asyncTearDown(self):
        await self.voice.close()
        self.which.stop()
        self.tmp.cleanup()

    async def wait_state(self, target):
        for _ in range(100):
            if self.voice.state in target:
                return
            await asyncio.sleep(.02)
        self.fail('State timed out: ' + self.voice.state)

    async def test_explicit_capture_finish_local_transcript_and_cleanup(self):
        self.assertIsNone(self.voice.token)
        result = await self.voice.start({})
        params = {'token': result['token']}
        await asyncio.sleep(.12)
        self.assertGreater(len(self.voice.audio), 0)
        self.assertLessEqual(len(self.voice.audio), MAX_BYTES)
        self.assertEqual(list((self.root / 'data').iterdir()), [])
        await self.voice.finish(params)
        await self.wait_state(('done', 'failed'))
        self.assertEqual((await self.voice.status(params))['text'], 'Installiere Programm X')
        self.assertEqual(self.voice.state, 'done', self.voice.error)
        self.assertEqual(list((self.root / 'data').iterdir()), [])
        self.assertEqual(len(self.voice.audio), 0)
        await self.voice.cancel(params)
        self.assertEqual(self.voice.text, '')
        self.assertIsNotNone(self.voice.capture.returncode)
        self.assertIsNotNone(self.voice.decoder.returncode)

    async def test_stale_token_cannot_cancel_new_capture_and_parallel_start_rejected(self):
        result = await self.voice.start({})
        with self.assertRaisesRegex(ValueError, 'bereits'):
            await self.voice.start({})
        await self.voice.cancel({'token': 'old'})
        self.assertEqual(self.voice.token, result['token'])
        with self.assertRaisesRegex(ValueError, 'aktuell'):
            await self.voice.status({'token': 'old'})
        await self.voice.cancel({'token': result['token']})
        self.assertEqual(self.voice.state, 'idle')
        self.assertEqual(len(self.voice.audio), 0)

    async def test_view_disconnect_stops_recording_and_discards_audio(self):
        await self.voice.start({})
        self.voice.seen = time.monotonic() - 9
        await asyncio.sleep(.65)
        self.assertIsNone(self.voice.token)
        self.assertIsNotNone(self.voice.capture.returncode)
        self.assertFalse(self.voice.audio)

    async def test_silence_is_rejected_without_running_decoder(self):
        result = await self.voice.start({})
        await asyncio.sleep(.04)
        await self.voice.cancel({'token': result['token']})
        self.voice.audio = bytearray(32000)
        self.voice.reader = None
        self.voice.state = 'transcribing'
        await self.voice.transcribe()
        self.assertEqual(self.voice.state, 'failed')
        self.assertIn('Keine Sprache', self.voice.error)
        self.assertIsNone(self.voice.decoder)

    async def test_tampered_model_never_opens_microphone(self):
        (self.root / 'bin/voice/model.bin').write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError, 'Prüfsumme'):
            await self.voice.start({})
        self.assertIsNone(self.voice.capture)
