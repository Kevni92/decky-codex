"""Read-only inventory and explicitly confirmed trash operations."""
import heapq
import os
import re
import shutil
import stat
import subprocess
import time
import uuid
from pathlib import Path


def within(path, root):
    return path == root or root in path.parents


def vdf(text):
    tokens = iter(re.findall(r'"((?:\\.|[^"\\])*)"|([{}])', text))
    def read():
        out = {}
        for quoted, brace in tokens:
            if brace == "}":
                return out
            if brace:
                raise ValueError("Ungültige Bibliotheksmetadaten")
            key = quoted.replace("\\\\", "\\")
            value, bracket = next(tokens)
            out[key] = read() if bracket == "{" else value.replace("\\\\", "\\")
        return out
    return read()


def steam_exclusions(home):
    roots = [home / ".local/share/Steam", home / ".steam/steam", home / ".steam/root"]
    excluded = set()
    warnings = []
    for root in roots:
        if not root.exists():
            continue
        root = root.resolve()
        excluded.add(root)
        excluded.add(root / "steamapps")
        meta = root / "steamapps/libraryfolders.vdf"
        if not meta.exists():
            warnings.append("Steam-Bibliotheksliste fehlt: zusätzliche Bibliotheken nicht vollständig erfasst.")
            continue
        try:
            if meta.stat().st_size > 2 * 1024 * 1024:
                raise ValueError("Datei zu groß")
            libraries = vdf(meta.read_text(errors="replace")).get("libraryfolders", {})
            for key, entry in libraries.items():
                if not key.isdigit():
                    continue
                path = entry.get("path") if isinstance(entry, dict) else entry
                if path and Path(path).is_absolute():
                    excluded.add(Path(path).resolve() / "steamapps")
        except (OSError, ValueError, StopIteration, RecursionError):
            warnings.append("Steam-Bibliotheksliste konnte nicht vollständig gelesen werden.")
    return excluded, list(dict.fromkeys(warnings))


class Inventory:
    def __init__(self, home, protected):
        self.home = Path(home).resolve()
        self.protected = [Path(p).resolve() for p in protected]
        self.result = None
        self.cancelled = False

    def exclusions(self):
        steam, warnings = steam_exclusions(self.home)
        sensitive = [self.home / p for p in (
            ".ssh", ".gnupg", ".codex", ".aws", ".config/google-chrome",
            ".config/chromium", ".mozilla", ".local/share/Trash",
            ".local/share/keyrings", ".config/BraveSoftware")]
        return list(steam) + self.protected + sensitive + [Path(p) for p in ("/proc", "/sys", "/dev", "/run")], warnings

    def scan(self, roots, limit=80):
        self.cancelled = False
        excluded, warnings = self.exclusions()
        roots = list(dict.fromkeys(Path(p).resolve() for p in roots))
        if not roots or len(roots) > 8:
            raise ValueError("Ein bis acht Scanverzeichnisse erforderlich.")
        found, seen, errors, visited = [], set(), 0, 0
        started = time.monotonic()
        for root in roots:
            if not root.is_dir():
                raise ValueError("Scanverzeichnis fehlt.")
            for directory, folders, files in os.walk(root, followlinks=False):
                if self.cancelled:
                    break
                parent = Path(directory)
                folders[:] = [f for f in folders if not (parent / f).is_symlink()
                              and not any(within(parent / f, x) for x in excluded)
                              and f not in ("steamapps",)]
                if any(within(parent, x) for x in excluded):
                    folders[:] = []
                    continue
                for name in files:
                    visited += 1
                    path = parent / name
                    try:
                        st = path.lstat()
                        identity = (st.st_dev, st.st_ino)
                        if not stat.S_ISREG(st.st_mode) or identity in seen:
                            continue
                        seen.add(identity)
                        allocated = st.st_blocks * 512
                        if allocated < 1024 * 1024:
                            continue
                        record = {"id": uuid.uuid4().hex, "path": str(path), "name": name,
                                  "bytes": allocated, "logicalBytes": st.st_size,
                                  "identity": [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns],
                                  "category": "Download" if within(path, self.home / "Downloads") else "Datei – Verwendung prüfen"}
                        entry = (allocated, str(path), record)
                        if len(found) < limit:
                            heapq.heappush(found, entry)
                        elif entry[:2] > found[0][:2]:
                            heapq.heapreplace(found, entry)
                    except OSError:
                        errors += 1
                if visited % 1000 == 0:
                    time.sleep(0.002)
                if time.monotonic() - started > 90:
                    warnings.append("Zeitlimit erreicht; Ergebnis ist unvollständig.")
                    self.cancelled = True
                    break
        if self.cancelled:
            warnings.append("Scan vorzeitig beendet; Ergebnis ist unvollständig.")
        self.result = {"id": uuid.uuid4().hex, "roots": [str(r) for r in roots],
                       "created": time.time(), "rows": [x[2] for x in sorted(found, reverse=True)],
                       "exclusions": [str(p) for p in excluded], "warnings": list(dict.fromkeys(warnings)),
                       "errors": errors, "visited": visited, "metric": "Belegter Platz (Dateisystemblöcke)"}
        return self.result

    def selected(self, scan_id, ids):
        if not self.result or self.result["id"] != scan_id or time.time() - self.result["created"] > 900:
            raise ValueError("Scan ist abgelaufen. Bitte erneut untersuchen.")
        ids = set(ids)
        rows = [r for r in self.result["rows"] if r["id"] in ids]
        if not rows or len(rows) != len(ids):
            raise ValueError("Ungültige Dateiauswahl.")
        excluded, warnings = self.exclusions()
        if warnings:
            raise ValueError("Steam-Zuordnung unvollständig. Bereinigung bleibt gesperrt.")
        for row in rows:
            path = Path(row["path"])
            if path.is_symlink() or path.resolve() != path or any(within(path, x) for x in excluded):
                raise ValueError("Ziel ist verändert oder geschützt.")
            st = path.lstat()
            if not stat.S_ISREG(st.st_mode) or row["identity"] != [st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns]:
                raise ValueError("Datei wurde seit dem Scan geändert.")
        return rows

    def trash(self, scan_id, ids):
        if not shutil.which("gio"):
            raise ValueError("Kein unterstützter Papierkorb verfügbar. Es wird nichts endgültig gelöscht.")
        rows = self.selected(scan_id, ids)
        done = []
        for row in rows:
            # Revalidate immediately before every non-destructive move.
            self.selected(scan_id, [row["id"]])
            subprocess.run(["gio", "trash", "--", row["path"]], check=True, timeout=20,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            done.append(row["path"])
        self.result = None
        return {"moved": done, "notice": "Im Papierkorb; Speicher wird erst durch dessen Leerung frei."}
