"""Host processes are only started after an explicit, scoped UI approval."""
import asyncio
import errno
import os
import pty
import re
import signal
import time
import uuid


def clean_output(text):
    text = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    return "".join(c for c in text if c in "\n\r\t" or ord(c) >= 32)


class Session:
    def __init__(self, process, master, changed, label):
        self.id = uuid.uuid4().hex
        self.process, self.master, self.changed, self.label = process, master, changed, label
        self.output = ""
        self.code = None
        self.started = time.time()
        self.closed = False
        self.reader = asyncio.create_task(self.read())
        self.waiter = asyncio.create_task(self.wait())

    @classmethod
    async def start(cls, argv, cwd, env, changed, label=None):
        if not isinstance(argv, list) or not argv or len(argv) > 128 or not all(isinstance(x, str) and "\0" not in x for x in argv):
            raise ValueError("Ungültiger Befehl.")
        master, slave = pty.openpty()
        os.set_blocking(master, False)
        try:
            process = await asyncio.create_subprocess_exec(*argv, cwd=str(cwd), env=env,
                stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        except BaseException:
            os.close(master)
            raise
        finally:
            os.close(slave)
        return cls(process, master, changed, label or " ".join(argv))

    async def read(self):
        loop = asyncio.get_running_loop()
        try:
            while not self.closed:
                ready = loop.create_future()
                loop.add_reader(self.master, lambda: None if ready.done() else ready.set_result(None))
                try:
                    await ready
                    data = os.read(self.master, 8192)
                finally:
                    loop.remove_reader(self.master)
                if not data:
                    break
                self.output = (self.output + clean_output(data.decode("utf-8", "replace")))[-128000:]
                self.changed()
        except OSError as exc:
            if exc.errno not in (errno.EIO, errno.EBADF):
                raise
        finally:
            if not self.closed:
                os.close(self.master)
                self.closed = True

    async def wait(self):
        self.code = await self.process.wait()
        self.changed()

    def write(self, text):
        if self.code is not None or self.closed:
            raise ValueError("Installer ist bereits beendet.")
        if not isinstance(text, str) or len(text) > 1024 or any(ord(c) < 32 for c in text):
            raise ValueError("Nur eine einzelne Antwortzeile ohne Steuerzeichen zulässig.")
        os.write(self.master, (text + "\n").encode())

    async def stop(self):
        if self.process.returncode is None:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
                await asyncio.wait_for(self.process.wait(), 4)
            except (ProcessLookupError, asyncio.TimeoutError):
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        if not self.closed:
            self.reader.cancel()

    def snapshot(self):
        return {"id": self.id, "label": self.label, "output": self.output,
                "exitCode": self.code, "started": self.started, "running": self.process.returncode is None}
