"""Real runtime handshake and protocol contract, without account/inference calls."""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.protocol import CodexClient
from backend.service import Service, TOOLS

async def main():
    version = subprocess.check_output([str(ROOT / "bin/codex"), "--version"], text=True).strip()
    assert version == "codex-cli 0.163.0", version
    subprocess.run([str(ROOT / "bin/codex"), "app-server", "generate-ts", "--experimental", "--out", str(ROOT / "schemas/generated")], check=True)
    schema = (ROOT / "schemas/generated/v2/DynamicToolSpec.ts").read_text()
    assert '"type": "function"' in schema
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp) / "home"
        home.mkdir()
        async def emit(_):
            pass
        service = Service(ROOT, Path(tmp) / "data", home, emit)
        await service.initialize()
        async def handler(message):
            if "id" in message:
                raise ValueError("No interactive requests in smoke test")
        client = CodexClient([str(ROOT / "bin/codex"), "app-server",
            "-c", 'model_provider="decky_contract"',
            "-c", 'model="decky-contract"',
            "-c", 'model_providers.decky_contract.name="Offline contract test"',
            "-c", 'model_providers.decky_contract.base_url="http://127.0.0.1:1"',
            "-c", 'model_providers.decky_contract.wire_api="responses"',
            "-c", 'model_providers.decky_contract.requires_openai_auth=false'], service.env(), service.workspace, handler)
        try:
            await client.start()
            config = await client.request("config/read", {"includeLayers": False})
            assert config["config"]["default_permissions"] == "decky"
            assert all(t["type"] == "function" for t in TOOLS)
            skills = await client.request("skills/list", {"cwds": [str(service.workspace)]})
            loaded = {skill["name"] for entry in skills.get("data", []) for skill in entry.get("skills", [])}
            assert "interactive-installation" in loaded and "storage-audit" in loaded, loaded
            print("Bundled Steam Deck skills discovered by real Codex runtime")
            # This Work environment has managed session hooks that a nested CLI
            # cannot satisfy. The clean GitHub runner also tests thread creation.
            if os.environ.get("GITHUB_ACTIONS") == "true":
                result = await client.request("thread/start", {"cwd": str(service.workspace), "permissions": "decky", "dynamicTools": TOOLS, "ephemeral": True})
                assert result["thread"]["id"]
                print("Real offline thread and dynamic-tool registration passed")
            print(f"{version}: real handshake, permission config and exported schema checks passed")
        finally:
            await client.close()
            await service.close()

if __name__ == "__main__":
    asyncio.run(main())
