"""Download the pinned official native package, verify integrity, preserve layout."""
import argparse
import base64
import hashlib
import json
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def prepare(archive=None):
    manifest = json.loads((ROOT / "runtime/manifest.json").read_text())
    cache = ROOT / ".runtime-cache"
    cache.mkdir(exist_ok=True)
    package = Path(archive) if archive else cache / "codex.tgz"
    if not package.exists():
        temporary = package.with_suffix(".part")
        with urllib.request.urlopen(manifest["url"], timeout=60) as response, temporary.open("wb") as out:
            shutil.copyfileobj(response, out)
        temporary.rename(package)
    expected = manifest["integrity"].split("-", 1)[1]
    actual = base64.b64encode(hashlib.file_digest(package.open("rb"), "sha512").digest()).decode()
    if actual != expected:
        raise SystemExit("Runtime integrity mismatch; refusing to package")
    destination = ROOT / "bin"
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir()
    with tempfile.TemporaryDirectory() as tmp:
        with tarfile.open(package) as tar:
            for member in tar.getmembers():
                if member.issym() or member.islnk() or member.name.startswith("/") or ".." in Path(member.name).parts:
                    raise SystemExit("Unsafe runtime archive")
            tar.extractall(tmp, filter="data")
        source = Path(tmp) / "package"
        shutil.copytree(source / "vendor", destination / "vendor")
        shutil.copyfile(source / "README.md", destination / "UPSTREAM_README.md")
    platform = manifest["platform"]
    # Preserve upstream code-mode, sandbox and resource discovery relative to its binary.
    (destination / "codex").write_text('#!/bin/sh\nexec "$(dirname "$0")/vendor/' + platform + '/bin/codex" "$@"\n')
    shutil.copyfile(destination / "vendor" / platform / "codex-path/rg", destination / "rg")
    for file in destination.rglob("*"):
        if file.is_file() and (file.suffix == "" or file.name.endswith(".so")):
            file.chmod(0o755)
    hashes = {str(p.relative_to(destination)): hashlib.file_digest(p.open("rb"), "sha256").hexdigest()
              for p in sorted(destination.rglob("*")) if p.is_file()}
    (ROOT / "runtime/installed.json").write_text(json.dumps({"version": manifest["version"], "files": hashes}, indent=2) + "\n")
    print(f"Verified Codex {manifest['version']}: {len(hashes)} runtime files")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive")
    prepare(parser.parse_args().archive)
