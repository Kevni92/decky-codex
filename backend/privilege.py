"""Separate local password channel. Never accept credentials from model tools."""
import asyncio
import fcntl
import hashlib
import json
import os
import secrets
import shutil
import socket
import struct
import time
from pathlib import Path
from .processes import Session


def sealed(data):
    fd = os.memfd_create("decky-codex-job", os.MFD_ALLOW_SEALING)
    os.write(fd, data)
    os.fchmod(fd, 0o700)
    fcntl.fcntl(fd, getattr(fcntl, "F_ADD_SEALS", 1033), 0x000F)  # Linux seal ABI: WRITE|GROW|SHRINK|SEAL
    return fd, f"/proc/{os.getpid()}/fd/{fd}"


def child_of(pid, parent):
    for _ in range(12):
        if pid == parent:
            return True
        try:
            status = Path(f"/proc/{pid}/status").read_text()
            pid = int(next(x.split()[1] for x in status.splitlines() if x.startswith("PPid:")))
        except (OSError, StopIteration, ValueError):
            return False
        if pid <= 1:
            return False
    return False


class RootJob:
    def __init__(self, root, data, env, changed, password_prompt):
        self.root, self.data, self.env = root, data, env
        self.changed, self.password_prompt = changed, password_prompt
        self.token = secrets.token_hex(32)
        self.path = data / ("auth-" + secrets.token_hex(5) + ".sock")
        self.server = None
        self.session = None
        self.fds = []
        self.delivered = False
        self.connections = []
        self.argv = None
        self.cwd = None
        self.created = time.monotonic()
        self.password_future = None

    def prepare(self, argv, cwd):
        self.argv = list(argv)
        self.cwd = str(cwd)
        identities = []
        for index, argument in enumerate(self.argv):
            candidate = Path(argument)
            if not candidate.is_absolute():
                candidate = Path(cwd) / candidate
            if candidate.is_file() and candidate.suffix in (".sh", ".py"):
                if candidate.stat().st_size > 2 * 1024 * 1024:
                    raise ValueError("Skript zu groß für einen gebundenen Root-Auftrag.")
                payload = candidate.read_bytes()
                fd, path = sealed(payload)
                self.fds.append(fd)
                self.argv[index] = path
                identities.append(str(candidate) + "\nSHA-256: " + hashlib.sha256(payload).hexdigest())
        return "\n\n".join(identities)

    async def start(self, argv, cwd):
        if not shutil.which("sudo") or not Path("/usr/bin/python3").exists():
            raise ValueError("sudo oder System-Python fehlt; Root-Auftrag nicht verfügbar.")
        if self.argv is None:
            self.prepare(argv, cwd)
        for name in ("askpass.py", "root_runner.py"):
            fd, path = sealed((self.root / "backend" / name).read_bytes())
            self.fds.append(fd)
            if name == "askpass.py":
                askpass = path
            else:
                runner = path
        self.server = await asyncio.start_unix_server(self._connection, path=str(self.path), limit=8192)
        os.chmod(self.path, 0o600)
        env = dict(self.env, SUDO_ASKPASS=askpass, DECKY_CODEX_AUTH_SOCKET=str(self.path), DECKY_CODEX_AUTH_TOKEN=self.token)
        self.session = await Session.start([shutil.which("sudo"), "-A", "-k", "--", "/usr/bin/python3", runner,
                                            str(self.path), self.token], cwd, env, self.changed,
                                           "Root: " + " ".join(argv))
        return self.session

    async def _connection(self, reader, writer):
        self.connections.append(writer)
        try:
            peer = writer.get_extra_info("socket").getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
            pid, uid, _ = struct.unpack("3i", peer)
            request = json.loads(await asyncio.wait_for(reader.readline(), 5))
            if not secrets.compare_digest(str(request.get("token", "")), self.token):
                return
            # Session assignment can lag a fast sudo child by one loop iteration.
            for _ in range(10):
                if self.session:
                    break
                await asyncio.sleep(0.01)
            if not self.session or not child_of(pid, self.session.process.pid):
                return
            if request.get("role") == "askpass" and uid == os.getuid() and time.monotonic() - self.created < 300:
                password = await self.password_prompt()
                if not isinstance(password, str) or not password or len(password) > 2048 or "\n" in password or "\0" in password:
                    return
                writer.write((json.dumps({"password": password}) + "\n").encode())
                await writer.drain()
                password = None
                self.delivered = True
            elif request.get("role") == "runner" and uid == 0:
                # NOPASSWD must never silently execute the requested command.
                if not self.delivered:
                    writer.write(b'{"authorized":false}\n')
                    await writer.drain()
                    return
                writer.write((json.dumps({"authorized": True, "argv": self.argv, "cwd": self.cwd,
                                          "env": {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/root",
                                                  "LANG": "C.UTF-8", "TERM": "dumb"}}) + "\n").encode())
                await writer.drain()
                await reader.read(1024)
        except (ValueError, OSError, asyncio.TimeoutError):
            pass
        finally:
            writer.close()

    async def close(self):
        for writer in self.connections:
            writer.close()
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        if self.session:
            await self.session.stop()
        self.path.unlink(missing_ok=True)
        for fd in self.fds:
            os.close(fd)
        self.fds.clear()
