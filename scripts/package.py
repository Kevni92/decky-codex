"""Build an allowlisted Decky ZIP and verify its installed contents."""
import hashlib
import json
import os
import stat
import zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
NAME = "Decky Codex"
FILES = ["plugin.json", "package.json", "main.py", "LICENSE", "THIRD_PARTY_NOTICES.md", "README.md"]
TREES = ["backend", "dist", "bin", "agent", "licenses"]

def package():
    from licenses import collect
    collect()
    plugin = json.loads((ROOT / "plugin.json").read_text())
    assert plugin["name"] == NAME and "_root" not in plugin["flags"]
    assert (ROOT / "dist/index.js").stat().st_size > 1000
    manifest = json.loads((ROOT / "runtime/installed.json").read_text())
    for name, expected in manifest["files"].items():
        with (ROOT / "bin" / name).open("rb") as source:
            assert hashlib.file_digest(source, "sha256").hexdigest() == expected, name
    files = [ROOT / p for p in FILES] + [ROOT / "runtime/manifest.json", ROOT / "runtime/installed.json"]
    for tree in TREES:
        files += [p for p in (ROOT / tree).rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix not in (".pyc", ".map")]
    out = ROOT / "out"
    out.mkdir(exist_ok=True)
    target = out / (NAME + ".zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for source in sorted(files):
            assert not source.is_symlink()
            path = str(source.relative_to(ROOT))
            info = zipfile.ZipInfo(NAME + "/" + path, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            mode = 0o755 if path.startswith("bin/") and os.access(source, os.X_OK) else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, source.read_bytes())
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        assert all(n.startswith(NAME + "/") and ".." not in Path(n).parts for n in names)
        assert NAME + "/main.py" in names and NAME + "/dist/index.js" in names
        assert not any("node_modules" in n or "auth.json" in n for n in names)
        assert archive.testzip() is None
    with target.open("rb") as source:
        checksum = hashlib.file_digest(source, "sha256").hexdigest()
    (out / "SHA256SUMS").write_text(checksum + "  " + target.name + "\n")
    (out / "build.json").write_text(json.dumps({"version": json.loads((ROOT / "package.json").read_text())["version"], "runtime": manifest["version"], "commit": os.environ.get("GITHUB_SHA", "local"), "sha256": checksum}, indent=2) + "\n")
    print(f"Verified installable ZIP: {target.name} ({target.stat().st_size:,} bytes)")

if __name__ == "__main__":
    package()
