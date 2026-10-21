"""Decky entry point. Never request Decky's _root flag."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import decky
from backend.service import Service


class Plugin:
    async def _main(self):
        root = Path(__file__).resolve().parent
        home = Path(os.environ.get("DECKY_USER_HOME", str(Path.home())))
        data = Path(os.environ.get("DECKY_PLUGIN_RUNTIME_DIR", str(home / "homebrew/data/decky-codex")))
        self.service = Service(root, data, home, self._emit)
        await self.service.initialize()

    async def _emit(self, state):
        await decky.emit("decky_codex_state", state)

    async def dispatch(self, method: str, params: dict = None):
        if not hasattr(self, "service"):
            raise RuntimeError("Decky Codex startet noch. Bitte erneut öffnen.")
        return await self.service.dispatch(method, params or {})

    async def _unload(self):
        if hasattr(self, "service"):
            await self.service.close()

    async def _uninstall(self):
        await self._unload()
