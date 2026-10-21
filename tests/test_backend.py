import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from backend.protocol import CodexClient
from backend.service import Service, TOOLS
from backend.storage import Inventory, steam_exclusions, vdf
from backend.privilege import sealed, child_of
from backend.processes import Session, clean_output

ROOT = Path(__file__).resolve().parents[1]


class ProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def test_server_request_does_not_block_client_reply(self):
        gate = asyncio.Event()
        async def handle(message):
            if message.get("method") == "test/question":
                await gate.wait()
                return {"answer": "yes"}
        client = CodexClient([sys.executable, str(ROOT / "tests/fake_server.py")], os.environ.copy(), ROOT, handle)
        try:
            await client.start()
            result = await client.request("challenge", timeout=2)
            self.assertEqual(result["method"], "challenge")
            gate.set()
            results = await asyncio.gather(*[client.request("ping") for _ in range(10)])
            self.assertEqual(len(results), 10)
        finally:
            await client.close()

    async def test_malformed_transport_fails_pending_calls(self):
        client = CodexClient([sys.executable, str(ROOT / "tests/fake_server.py")], os.environ.copy(), ROOT, AsyncMock())
        try:
            await client.start()
            with self.assertRaises(RuntimeError):
                await client.request("malformed", timeout=2)
            self.assertTrue(client.error)
        finally:
            await client.close()


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.home.mkdir()
        self.service = Service(ROOT, Path(self.tmp.name) / "data", self.home, AsyncMock())
        await self.service.initialize()

    async def asyncTearDown(self):
        await self.service.close()
        self.tmp.cleanup()

    async def test_context_is_installed_and_sensitive_config_restricted(self):
        self.assertIn("Steam-Deck-Assistent", (self.service.codex_home / "AGENTS.md").read_text())
        self.assertEqual(len(list((self.service.codex_home / "skills").glob("*/SKILL.md"))), 6)
        self.assertIn(' = "deny"', (self.service.codex_home / "config.toml").read_text())
        self.assertEqual({t["type"] for t in TOOLS}, {"function"})

    async def test_question_generation_options_and_exactly_once(self):
        task = asyncio.create_task(self.service.ask("question", "X oder Y", options=[{"id": "x", "value": "actual-X", "label": "X", "description": "Auswirkung"}]))
        await asyncio.sleep(0)
        rid = next(iter(self.service.requests))
        with self.assertRaises(ValueError):
            await self.service.resolve({"id": rid, "generation": "old", "choice": "x"})
        with self.assertRaises(ValueError):
            await self.service.resolve({"id": rid, "generation": self.service.generation, "choice": "other"})
        await self.service.resolve({"id": rid, "generation": self.service.generation, "choice": "x"})
        self.assertEqual(await task, "actual-X")
        with self.assertRaises(ValueError):
            await self.service.resolve({"id": rid, "generation": self.service.generation, "choice": "x"})

    async def test_declining_host_command_never_starts_process(self):
        with patch.object(Session, "start", new_callable=AsyncMock) as start:
            task = asyncio.create_task(self.service.run_tool("decky_exec", {"argv": ["touch", "/tmp/should-not-exist"], "reason": "test"}))
            await asyncio.sleep(0)
            self.assertFalse(start.called)
            request = next(iter(self.service.requests))
            await self.service.resolve({"id": request, "generation": self.service.generation, "choice": "cancel"})
            with self.assertRaises(ValueError):
                await task
            start.assert_not_called()

    async def test_password_not_in_snapshot_or_persistence(self):
        task = asyncio.create_task(self.service.ask("password", "Lokal"))
        await asyncio.sleep(0)
        rid = next(iter(self.service.requests))
        secret = "test-secret-never-log"
        await self.service.resolve({"id": rid, "generation": self.service.generation, "choice": "accept", "password": secret})
        self.assertEqual(await task, secret)
        self.assertNotIn(secret, json.dumps(self.service.snapshot()))
        self.assertNotIn(secret.encode(), (self.service.data / "chats.sqlite3").read_bytes())

    async def test_chat_metadata_persists_and_dispatch_allowlist(self):
        cid = await self.service.new_chat({})
        await self.service.rename_chat({"id": cid, "title": "Test"})
        self.assertEqual(json.loads(self.service.db.execute("SELECT body FROM chats").fetchone()[0])["title"], "Test")
        with self.assertRaises(ValueError):
            await self.service.dispatch("run_arbitrary_python", {})

    async def test_native_escalation_declined_and_empty_permissions(self):
        response = await self.service.handle({"id": 1, "method": "item/commandExecution/requestApproval", "params": {}})
        self.assertEqual(response, {"decision": "decline"})
        response = await self.service.handle({"id": 2, "method": "item/permissions/requestApproval", "params": {}})
        self.assertEqual(response["permissions"], {})


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.inventory = Inventory(self.home, [])

    def tearDown(self):
        self.tmp.cleanup()

    def large(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"a" * (2 * 1024 * 1024))

    def test_external_library_sensitive_data_symlinks_and_hardlinks(self):
        steam = self.home / ".local/share/Steam"
        lib = self.home / "sd-card"
        metadata = steam / "steamapps/libraryfolders.vdf"
        metadata.parent.mkdir(parents=True)
        metadata.write_text('"libraryfolders" {"0" {"path" "' + str(lib) + '"}}')
        self.large(lib / "steamapps/common/Game/game.bin")
        self.large(self.home / ".ssh/private-key")
        self.large(self.home / "Downloads/installer.zip")
        os.link(self.home / "Downloads/installer.zip", self.home / "hardlink.zip")
        (self.home / "symlink").symlink_to(lib, target_is_directory=True)
        result = self.inventory.scan([self.home])
        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["rows"][0]["bytes"], 2 * 1024 * 1024)
        self.assertFalse(result["warnings"])

    def test_changed_file_not_actionable(self):
        file = self.home / "large"
        self.large(file)
        result = self.inventory.scan([self.home])
        file.write_text("changed")
        with self.assertRaises(ValueError):
            self.inventory.selected(result["id"], [result["rows"][0]["id"]])

    def test_broken_steam_metadata_blocks_cleanup(self):
        meta = self.home / ".local/share/Steam/steamapps/libraryfolders.vdf"
        meta.parent.mkdir(parents=True)
        meta.write_text('"libraryfolders" {"0"')
        self.large(self.home / "installer")
        result = self.inventory.scan([self.home])
        self.assertTrue(result["warnings"])
        with self.assertRaises(ValueError):
            self.inventory.selected(result["id"], [result["rows"][0]["id"]])

    def test_unsafe_selection_and_absent_trash_fail_closed(self):
        self.large(self.home / "file")
        result = self.inventory.scan([self.home])
        with self.assertRaises(ValueError):
            self.inventory.selected("stale", ["x"])
        with patch("backend.storage.shutil.which", return_value=None):
            with self.assertRaises(ValueError):
                self.inventory.trash(result["id"], [result["rows"][0]["id"]])


class LocalProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_pty_bidirectional_input(self):
        session = await Session.start([sys.executable, "-u", "-c", "print('Choice?', flush=True); print('got:'+input(), flush=True)"], ROOT, os.environ.copy(), lambda: None)
        try:
            for _ in range(40):
                if "Choice?" in session.output:
                    break
                await asyncio.sleep(0.025)
            self.assertIn("Choice?", session.output)
            session.write("X")
            await asyncio.wait_for(session.waiter, 3)
            await asyncio.wait_for(session.reader, 3)
            self.assertIn("got:X", session.output)
            self.assertEqual(session.code, 0)
            with self.assertRaises(ValueError):
                session.write("late")
        finally:
            await session.stop()

    async def test_control_characters_and_osc_are_not_ui_commands(self):
        self.assertEqual(clean_output("\x1b]52;c;ZXZpbA==\x07hello\x1b[31m"), "hello")

    async def test_root_payload_is_sealed(self):
        fd, path = sealed(b"fixed payload")
        try:
            self.assertEqual(os.pread(fd, 13, 0), b"fixed payload")
            with self.assertRaises(OSError):
                os.write(fd, b"changed")
            self.assertTrue(child_of(os.getpid(), os.getpid()))
        finally:
            os.close(fd)

if __name__ == "__main__":
    unittest.main()
