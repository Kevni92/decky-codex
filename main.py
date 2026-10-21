"""Decky entry point. Never request Decky's _root flag."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import decky


class Plugin:
    def __init__(self):
        self.ready = asyncio.Event()
        self.service = None
        self.startup_error = ""

    async def _main(self):
        try:
            # Keep import failures inside the RPC-capable plugin, so Decky can
            # report them instead of losing the backend before socket setup.
            from backend.service import Service
            root = Path(__file__).resolve().parent
            home = Path(os.environ.get("DECKY_USER_HOME", str(Path.home())))
            data = Path(os.environ.get("DECKY_PLUGIN_RUNTIME_DIR", str(home / "homebrew/data/decky-codex")))
            self.service = Service(root, data, home, self._emit)
            await self.service.initialize()
        except Exception as exc:
            self.startup_error = f"{type(exc).__name__}: {exc}"[:800]
            decky.logger.exception("Decky Codex: Backend-Start fehlgeschlagen")
        finally:
            self.ready.set()

    async def _emit(self, state):
        await decky.emit("decky_codex_state", state)

    async def dispatch(self, method: str, params: dict = None):
        try:
            await asyncio.wait_for(self.ready.wait(), 10)
        except asyncio.TimeoutError:
            raise RuntimeError("Decky Codex: Backend-Start dauert zu lange. Bitte Decky neu starten.") from None
        if self.startup_error:
            raise RuntimeError("Backend-Start fehlgeschlagen: " + self.startup_error)
        if self.service is None:
            raise RuntimeError("Decky Codex: Backend ist nicht verfügbar.")
        return await self.service.dispatch(method, params or {})

    async def _unload(self):
        if self.service is not None:
            await self.service.close()

    async def _uninstall(self):
        await self._unload()
