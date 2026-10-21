"""Collect original dependency license texts from the frozen npm install."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def collect():
    texts = []
    for package in sorted((ROOT / "node_modules").glob("**/package.json")):
        try:
            metadata = json.loads(package.read_text())
        except (OSError, ValueError):
            continue
        for name in ("LICENSE", "license", "LICENSE.md", "license.md", "LICENSE.txt", "LICENSE-MIT", "COPYING"):
            path = package.parent / name
            if path.is_file():
                texts.append(metadata.get("name", "unknown") + " " + metadata.get("version", "") + "\n" + path.read_text(errors="replace"))
                break
    (ROOT / "licenses").mkdir(exist_ok=True)
    (ROOT / "licenses/frontend.txt").write_text("\n\n--------------------\n\n".join(texts))

if __name__ == "__main__":
    collect()
