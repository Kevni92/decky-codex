"""Application state, bounded persistence, structured tools and UI approvals."""
import asyncio
import fcntl
import hashlib
import json
import os
import platform
import shlex
import shutil
import sqlite3
import time
import uuid
from pathlib import Path
from .protocol import CodexClient
from .processes import Session
from .privilege import RootJob
from .storage import Inventory, within


def tool(name, description, properties, required=()):
    return {"type": "function", "name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}}


STRING = {"type": "string"}
TOOLS = [
    tool("decky_exec", "Run an installer or host command after explicit user approval. Use argv, not a shell when possible. Returns a live sessionId; poll it. Root requires separate local password authentication. All host access in this tool is disclosed as unsandboxed.",
         {"argv": {"type": "array", "items": STRING}, "cwd": STRING, "reason": STRING, "root": {"type": "boolean"}}, ["argv", "reason"]),
    tool("decky_poll", "Read output and exit status of an installer session. A running process may be waiting for input. Never claim success without checking.", {"sessionId": STRING}, ["sessionId"]),
    tool("decky_input", "Send one answer to a running installer. Explain/research important choices and use decky_ask first. Only empty default or a safe home path may be marked automatic. Never submit passwords.",
         {"sessionId": STRING, "value": STRING, "reason": STRING, "automatic": {"type": "boolean"}}, ["sessionId", "value", "reason"]),
    tool("decky_ask", "Ask the user a meaningful choice in a controller-friendly chat card. Explain the impact of each option. Wait for the answer; no default on timeout.",
         {"question": STRING, "options": {"type": "array", "items": {"type": "object", "properties": {"label": STRING, "description": STRING, "value": STRING}, "required": ["label", "description", "value"], "additionalProperties": False}}}, ["question", "options"]),
    tool("decky_storage_scan", "Find large files by allocated bytes, excluding all known Steam libraries and sensitive data. Shows a real selectable table. Default root is the user's home. Never interpret a scan as deletion consent.",
         {"roots": {"type": "array", "items": STRING}}),
    tool("decky_propose_cleanup", "Propose moving specifically selected inventory IDs to the trash. User must explicitly confirm; never delete permanently. Trash does not free space until emptied.",
         {"scanId": STRING, "ids": {"type": "array", "items": STRING}}, ["scanId", "ids"]),
]


class Service:
    def __init__(self, root, data, home, emit):
        self.root, self.data, self.home = Path(root), Path(data), Path(home).resolve()
        self.emit = emit
        self.codex_home, self.workspace = self.data / "codex", self.data / "workspace"
        self.client = None
        self.start_lock = asyncio.Lock()
        self.send_lock = asyncio.Lock()
        self.host_lock = asyncio.Lock()
        self.scan_lock = asyncio.Lock()
        self.db = None
        self.lockfile = None
        self.chats = []
        self.current = None
        self.turn = None
        self.busy = False
        self.account = None
        self.models = []
        self.requests = {}
        self.sessions = {}
        self.root_jobs = []
        self.activities = []
        self.inventory = Inventory(home, [data, root])
        self.error = ""
        self.login = None
        self.flush_task = None
        self.generation = uuid.uuid4().hex
        self.closed = False
        self.tools_tasks = set()
        self.seen_sends = set()
        self.last_activity = time.monotonic()

    async def initialize(self):
        for p in (self.data, self.codex_home, self.workspace):
            p.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(p, 0o700)
        self.lockfile = (self.data / "backend.lock").open("a+")
        fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.db = sqlite3.connect(self.data / "chats.sqlite3")
        os.chmod(self.data / "chats.sqlite3", 0o600)
        self.db.execute("CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        self.chats = [json.loads(row[0]) for row in self.db.execute("SELECT body FROM chats")]
        self.chats.sort(key=lambda c: c["updated"], reverse=True)
        for chat in self.chats:
            for message in chat["messages"]:
                message.pop("streaming", None)
        self.current = self.chats[0]["id"] if self.chats else None
        self._install_agent_context()
        self.reaper = asyncio.create_task(self._reap())

    def _install_agent_context(self):
        source = self.root / "agent"
        if not (source / "AGENTS.md").is_file():
            raise ValueError("Agenten-Regelpaket fehlt.")
        shutil.copyfile(source / "AGENTS.md", self.codex_home / "AGENTS.md")
        target = self.codex_home / "skills"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source / "skills", target)
        workspace_skills = self.workspace / ".agents/skills"
        if workspace_skills.exists():
            shutil.rmtree(workspace_skills)
        shutil.copytree(source / "skills", workspace_skills)
        # Workspace guidance is controlled; downloaded files never become its root.
        shutil.copyfile(source / "AGENTS.md", self.workspace / "AGENTS.md")
        self.agent_text = (source / "AGENTS.md").read_text()
        paths = [self.root, self.codex_home, self.home / ".ssh", self.home / ".gnupg",
                 self.home / ".aws", self.home / ".codex", self.home / ".mozilla",
                 self.home / ".config/google-chrome", self.home / ".config/chromium",
                 self.home / ".local/share/keyrings"]
        config = ['approval_policy = "on-request"', 'cli_auth_credentials_store = "file"',
                  'web_search = "live"', 'default_permissions = "decky"',
                  '[permissions.decky]', 'extends = ":read-only"',
                  '[permissions.decky.filesystem]', '":root" = "read"']
        for path in paths:
            # Codex reads its own auth before executing sandboxed tools.
            config.append(json.dumps(str(path)) + ' = "deny"')
        config += ['[features]', 'js_repl = false']
        (self.codex_home / "config.toml").write_text("\n".join(config) + "\n")
        os.chmod(self.codex_home / "config.toml", 0o600)

    def env(self):
        keep = ("LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS")
        env = {k: os.environ[k] for k in keep if k in os.environ}
        env.update(HOME=str(self.home), CODEX_HOME=str(self.codex_home),
                   PATH=str(self.root / "bin") + ":/usr/local/bin:/usr/bin:/bin", TERM="dumb")
        return env

    async def ensure_client(self):
        async with self.start_lock:
            if self.client and self.client.process.returncode is None and not self.client.error:
                return
            if self.client:
                await self.client.close()
            if os.geteuid() == 0:
                raise ValueError("Plugin wurde als Root gestartet. Decky Codex benötigt einen Benutzerprozess (kein _root-Flag).")
            if platform.machine() not in ("x86_64", "AMD64"):
                raise ValueError("Diese Ausgabe unterstützt Steam Deck mit Linux x86_64.")
            installed = self.root / "runtime/installed.json"
            if not installed.exists():
                raise ValueError("Runtime fehlt. Bitte die Release-ZIP installieren, nicht den GitHub-Quellcode.")
            manifest = json.loads(installed.read_text())
            for filename, expected in manifest["files"].items():
                path = self.root / "bin" / filename
                def digest(p=path):
                    with p.open("rb") as stream:
                        return hashlib.file_digest(stream, "sha256").hexdigest()
                actual = await asyncio.to_thread(digest)
                if actual != expected:
                    raise ValueError("Runtime-Prüfsumme falsch. Plugin erneut aus der Release-ZIP installieren.")
            self.client = CodexClient([str(self.root / "bin/codex"), "app-server"], self.env(), self.workspace, self.handle)
            try:
                await self.client.start()
            except BaseException:
                await self.client.close()
                self.client = None
                raise
            self.error = ""
            self.last_activity = time.monotonic()

    def chat(self, chat_id=None):
        selected = self.current if chat_id is None else chat_id
        for chat in self.chats:
            if chat["id"] == selected:
                return chat
        raise ValueError("Chat wurde nicht gefunden.")

    def persist(self, chat):
        chat["updated"] = time.time()
        self.db.execute("INSERT OR REPLACE INTO chats VALUES (?,?)", (chat["id"], json.dumps(chat, ensure_ascii=False)))
        self.db.commit()

    def snapshot(self):
        chat = next((c for c in self.chats if c["id"] == self.current), None)
        return {"generation": self.generation, "version": "0.1.0", "chat": chat, "busy": self.busy,
                "account": self.account, "models": self.models, "error": self.error, "login": self.login,
                "chats": [{"id": c["id"], "title": c["title"], "updated": c["updated"]} for c in sorted(self.chats, key=lambda c: c["updated"], reverse=True)],
                "requests": [r["public"] for r in self.requests.values()],
                "activities": self.activities[-60:], "sessions": [s.snapshot() for s in list(self.sessions.values())[-8:]],
                "inventory": self.inventory.result}

    def changed(self):
        if not self.closed and (not self.flush_task or self.flush_task.done()):
            self.flush_task = asyncio.create_task(self._flush())

    async def _flush(self):
        await asyncio.sleep(0.1)
        try:
            await self.emit(self.snapshot())
        except Exception:
            pass  # Closing a view must not stop a running job.

    def activity(self, title, details="", status="running", key=None):
        row = next((a for a in self.activities if a["id"] == key), None) if key else None
        if row:
            row.update(title=title, details=details, status=status)
        else:
            self.activities.append({"id": key or uuid.uuid4().hex, "title": title, "details": str(details)[-32000:], "status": status, "time": time.time()})
        self.activities = self.activities[-60:]
        self.changed()

    async def ask(self, kind, title, details="", options=None):
        rid = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.requests[rid] = {"future": future, "public": {"id": rid, "kind": kind,
            "title": title, "details": details, "options": options or [], "generation": self.generation}}
        self.changed()
        try:
            return await asyncio.wait_for(future, 300)
        finally:
            self.requests.pop(rid, None)
            self.changed()

    async def resolve(self, params):
        request = self.requests.get(params.get("id"))
        if not request or params.get("generation") != self.generation or request["future"].done():
            raise ValueError("Frage ist nicht mehr aktuell.")
        choice = str(params.get("choice", "cancel"))
        if choice == "cancel":
            request["future"].set_exception(ValueError("Vom Nutzer abgebrochen."))
            return
        public = request["public"]
        if public["kind"] == "password":
            value = params.get("password")
            if not isinstance(value, str) or not value or len(value) > 2048:
                raise ValueError("Passwort fehlt.")
        elif public["kind"] == "text":
            value = str(params.get("text", ""))[:4000]
        elif public["options"]:
            allowed = {o["id"]: o["value"] for o in public["options"]}
            if choice not in allowed:
                raise ValueError("Ungültige Auswahl.")
            value = allowed[choice]
        else:
            if choice != "accept":
                raise ValueError("Ungültige Freigabe.")
            value = True
        request["future"].set_result(value)
        self.changed()

    async def dispatch(self, method, params):
        self.last_activity = time.monotonic()
        allowed = {"snapshot": self.get_snapshot, "login": self.start_login, "logout": self.logout,
                   "new_chat": self.new_chat, "open_chat": self.open_chat, "rename_chat": self.rename_chat,
                   "delete_chat": self.delete_chat, "send": self.send, "interrupt": self.interrupt,
                   "resolve": self.resolve, "scan": self.start_scan, "cleanup": self.start_cleanup,
                   "cancel_scan": self.cancel_scan, "stop_session": self.stop_session,
                   "refresh_account": self.refresh_account}
        if method not in allowed or not isinstance(params, dict):
            raise ValueError("Unbekannte Anfrage.")
        try:
            result = await allowed[method](params)
            return {"ok": True, "result": result, "state": self.snapshot()}
        except (ValueError, RuntimeError, OSError, asyncio.TimeoutError) as exc:
            # Never stringify params: the isolated password submission may be present.
            self.error = str(exc)[:800] or "Zeitlimit erreicht. Zustand prüfen und erneut versuchen."
            self.changed()
            return {"ok": False, "error": self.error, "state": self.snapshot()}

    async def get_snapshot(self, _):
        return None

    async def refresh_account(self, _):
        await self.ensure_client()
        account = await self.client.request("account/read")
        self.account = account.get("account")
        if self.account:
            result = await self.client.request("model/list", {"limit": 50})
            self.models = result.get("data", [])
        self.changed()

    async def start_login(self, _):
        await self.ensure_client()
        result = await self.client.request("account/login/start", {"type": "chatgptDeviceCode"})
        self.login = {k: result[k] for k in ("verificationUrl", "userCode", "loginId", "authUrl") if k in result}
        self.changed()
        return self.login

    async def logout(self, _):
        if self.busy or any(s.process.returncode is None for s in self.sessions.values()):
            raise ValueError("Laufende Aufgaben zuerst beenden.")
        await self.ensure_client()
        await self.client.request("account/logout")
        self.account, self.login, self.models = None, None, []

    async def new_chat(self, _):
        if self.busy:
            raise ValueError("Aktuelle Aufgabe zuerst beenden.")
        chat = {"id": uuid.uuid4().hex, "title": "Neuer Chat", "thread": None, "updated": time.time(), "messages": []}
        self.chats.append(chat)
        self.current = chat["id"]
        self.activities = []
        self.persist(chat)
        return chat["id"]

    async def open_chat(self, params):
        if self.busy:
            raise ValueError("Aktuelle Aufgabe zuerst beenden.")
        self.current = self.chat(params.get("id"))["id"]
        self.activities = []

    async def rename_chat(self, params):
        chat = self.chat(params.get("id"))
        title = str(params.get("title", "")).strip()[:120]
        if not title:
            raise ValueError("Titel fehlt.")
        chat["title"] = title
        self.persist(chat)

    async def delete_chat(self, params):
        if self.busy:
            raise ValueError("Aktuelle Aufgabe zuerst beenden.")
        chat = self.chat(params.get("id"))
        if chat["thread"]:
            await self.ensure_client()
            # Real runtime deletion; never mislabel archive/hide as deletion.
            await self.client.request("thread/delete", {"threadId": chat["thread"]})
        self.db.execute("DELETE FROM chats WHERE id=?", (chat["id"],))
        self.db.commit()
        self.chats.remove(chat)
        self.current = self.chats[0]["id"] if self.chats else None

    async def send(self, params):
        text = str(params.get("text", "")).strip()
        nonce = params.get("nonce")
        if not text or len(text.encode()) > 16384 or not isinstance(nonce, str):
            raise ValueError("Nachricht fehlt oder ist zu lang.")
        async with self.send_lock:
            if nonce in self.seen_sends:
                return
            if self.busy:
                raise ValueError("Eine Aufgabe läuft bereits.")
            await self.ensure_client()
            if not self.current:
                await self.new_chat({})
            chat = self.chat()
            if not chat["thread"]:
                result = await self.client.request("thread/start", {
                    "cwd": str(self.workspace), "approvalPolicy": "on-request", "permissions": "decky",
                    "developerInstructions": self.agent_text,
                    "dynamicTools": TOOLS})
                chat["thread"] = result["thread"]["id"]
            else:
                await self.client.request("thread/resume", {"threadId": chat["thread"],
                    "cwd": str(self.workspace), "developerInstructions": self.agent_text})
            if len(chat["messages"]) >= 400 or sum(len(m["text"].encode()) for m in chat["messages"]) > 2 * 1024 * 1024:
                raise ValueError("Lokales Nachrichtenlimit erreicht. Bitte einen neuen Chat beginnen.")
            self.seen_sends.add(nonce)
            self.busy = True
            self.error = ""
            self.activities = []
            self.activity("Denkt nach …")
            chat["messages"].append({"id": uuid.uuid4().hex, "role": "user", "text": text})
            if chat["title"] == "Neuer Chat":
                chat["title"] = text[:70]
            self.persist(chat)
            self.changed()
            request = {"threadId": chat["thread"], "input": [{"type": "text", "text": text}]}
            model = params.get("model")
            if model:
                request["model"] = model
            try:
                result = await self.client.request("turn/start", request)
                self.turn = result.get("turn", {}).get("id")
            except BaseException:
                self.busy = False
                self.activity("Senden fehlgeschlagen – nicht automatisch wiederholt", status="failed")
                self.changed()
                raise

    async def interrupt(self, _):
        for request in list(self.requests.values()):
            if not request["future"].done():
                request["future"].set_exception(ValueError("Aufgabe abgebrochen."))
        if self.client and self.busy and self.turn:
            await self.client.request("turn/interrupt", {"threadId": self.chat()["thread"], "turnId": self.turn})
        for job in self.root_jobs:
            await job.close()
        self.root_jobs.clear()
        for session in self.sessions.values():
            await session.stop()
        self.busy = False
        self.changed()

    async def handle(self, message):
        method, p = message.get("method", ""), message.get("params", {})
        self.last_activity = time.monotonic()
        if "id" in message:
            if method == "item/tool/call":
                try:
                    args = p.get("arguments", {})
                    if isinstance(args, str):
                        args = json.loads(args)
                    result = await self.run_tool(p.get("tool", ""), args)
                    return {"contentItems": [{"type": "inputText", "text": json.dumps(result, ensure_ascii=False)}], "success": True}
                except Exception as exc:
                    return {"contentItems": [{"type": "inputText", "text": str(exc)[:800]}], "success": False}
            if method in ("item/tool/requestUserInput", "tool/requestUserInput"):
                answers = {}
                for question in p.get("questions", []):
                    options = [{"id": str(i), "value": o["label"], "label": o["label"], "description": o.get("description", "")}
                               for i, o in enumerate(question.get("options", []))]
                    answer = await self.ask("question" if options else "text", question.get("question", "Deine Entscheidung"), options=options)
                    answers[question["id"]] = {"answers": [answer]}
                return {"answers": answers}
            if method == "item/commandExecution/requestApproval" or method == "item/fileChange/requestApproval":
                self.activity("Native Erweiterung abgelehnt", "Änderungen müssen das explizit bestätigte decky_exec-Werkzeug verwenden.", "declined")
                return {"decision": "decline"}
            if method == "item/permissions/requestApproval":
                return {"permissions": {}, "scope": "turn"}
            raise ValueError("Nicht unterstützte Serveranfrage.")
        if method == "item/agentMessage/delta" and self.current:
            chat = self.chat()
            mid = p.get("itemId", "assistant")
            row = next((m for m in chat["messages"] if m["id"] == mid), None)
            if not row:
                row = {"id": mid, "role": "assistant", "text": ""}
                chat["messages"].append(row)
            row["text"] = (row["text"] + p.get("delta", ""))[-128000:]
        elif method == "item/started":
            item = p.get("item", {})
            kind = item.get("type", "")
            if kind not in ("userMessage", "agentMessage", "reasoning"):
                self.activity({"webSearch": "Recherchiert …", "commandExecution": "Prüft das System …", "dynamicToolCall": "Lokales Werkzeug …"}.get(kind, "Arbeitet …"),
                              json.dumps(item, ensure_ascii=False), key=item.get("id"))
        elif method == "item/completed":
            item = p.get("item", {})
            if item.get("type") == "agentMessage" and self.current:
                row = next((m for m in self.chat()["messages"] if m["id"] == item.get("id")), None)
                if not row:
                    self.chat()["messages"].append({"id": item.get("id", uuid.uuid4().hex), "role": "assistant", "text": item.get("text", "")})
            for a in self.activities:
                if a["id"] == item.get("id"):
                    a["status"] = "completed"
        elif method == "item/commandExecution/outputDelta":
            for a in self.activities:
                if a["id"] == p.get("itemId"):
                    a["details"] = (a["details"] + p.get("delta", ""))[-32000:]
        elif method == "turn/started":
            self.turn = p.get("turn", {}).get("id")
        elif method == "turn/completed":
            self.busy = False
            self.turn = None
            status = p.get("turn", {}).get("status", "completed")
            for a in self.activities:
                if a["status"] == "running":
                    a["status"] = status
            for request in list(self.requests.values()):
                if not request["future"].done():
                    request["future"].set_exception(ValueError("Turn beendet."))
            if self.current:
                self.persist(self.chat())
        elif method == "account/login/completed":
            self.login = None
            if p.get("success"):
                asyncio.create_task(self.refresh_account({}))
            else:
                self.error = "Anmeldung fehlgeschlagen. Gerätecode-Freigabe im ChatGPT-Konto prüfen."
        elif method in ("error", "transport/closed"):
            error = p.get("error", p)
            self.error = str(error.get("message", "Codex-Verbindung unterbrochen."))[:800]
            if method == "transport/closed":
                self.busy = False
        self.changed()

    def background(self, coro):
        async def run():
            try:
                await coro
            except Exception as exc:
                self.error = str(exc)[:800]
                self.changed()
        task = asyncio.create_task(run())
        self.tools_tasks.add(task)
        task.add_done_callback(self.tools_tasks.discard)

    async def start_scan(self, params):
        self.background(self.run_tool("decky_storage_scan", params))

    async def cancel_scan(self, _):
        self.inventory.cancelled = True

    async def start_cleanup(self, params):
        self.background(self.run_tool("decky_propose_cleanup", params))

    async def stop_session(self, params):
        session = self.sessions.get(params.get("id"))
        if session:
            for job in self.root_jobs:
                if job.session is session:
                    await job.close()
                    return
            await session.stop()

    async def run_tool(self, name, args):
        lock = self.host_lock if name == "decky_exec" else self.scan_lock if name == "decky_storage_scan" else None
        if lock:
            if lock.locked():
                raise ValueError("Eine entsprechende Aufgabe oder Freigabe läuft bereits.")
            async with lock:
                return await self._run_tool(name, args)
        return await self._run_tool(name, args)

    async def _run_tool(self, name, args):
        if not isinstance(args, dict):
            raise ValueError("Ungültige Werkzeugargumente.")
        if name == "decky_ask":
            options = args.get("options", [])
            if not isinstance(options, list) or not 2 <= len(options) <= 8:
                raise ValueError("Zwei bis acht Optionen erforderlich.")
            choices = [{"id": str(i), "label": str(o["label"])[:100], "description": str(o["description"])[:1200], "value": str(o["value"])[:1024]} for i, o in enumerate(options)]
            answer = await self.ask("question", str(args.get("question", "Deine Entscheidung"))[:2000], options=choices)
            self.activity("Deine Auswahl", str(answer), "completed")
            return {"answer": answer}
        if name == "decky_exec":
            argv = args.get("argv")
            if not isinstance(argv, list) or not argv or len(argv) > 128 or not all(isinstance(a, str) and "\0" not in a and len(a) < 8192 for a in argv):
                raise ValueError("Ungültiger Befehl.")
            if len(self.sessions) >= 16:
                self.sessions = {sid: s for sid, s in self.sessions.items() if s.process.returncode is None}
            if any(s.process.returncode is None for s in self.sessions.values()):
                raise ValueError("Es läuft bereits ein Host-Prozess. Zuerst abschließen oder stoppen.")
            cwd = Path(args.get("cwd") or self.workspace).resolve()
            if not cwd.is_dir():
                raise ValueError("Arbeitsverzeichnis fehlt.")
            root = args.get("root") is True
            if Path(argv[0]).name in ("sudo", "su", "pkexec", "doas"):
                raise ValueError("Privilegierung nur über root=true; kein verschachteltes sudo.")
            details = str(args.get("reason", ""))[:2000] + "\n\n" + shlex.join(argv) + "\n\nArbeitsverzeichnis: " + str(cwd)
            details += "\n\nDieser freigegebene Prozess hat " + ("Root-Rechte" if root else "die Rechte deines Linux-Benutzers") + ". Die Codex-Lesesandbox begrenzt ihn nicht."
            job = None
            if root:
                async def password():
                    return await self.ask("password", "Linux-Benutzerpasswort", "Nur lokale Authentifizierung. Das Passwort wird nicht an Codex übermittelt.")
                job = RootJob(self.root, self.data, self.env(), self.changed, password)
                try:
                    identities = job.prepare(argv, cwd)
                except BaseException:
                    await job.close()
                    raise
                if identities:
                    details += "\n\nGebundener Skriptinhalt:\n" + identities
            try:
                await self.ask("root" if root else "approval", "Administratoraktion freigeben" if root else "Befehl ausführen?", details)
                self.inventory.result = None
                if root:
                    session = await job.start(argv, cwd)
                    self.root_jobs.append(job)
                else:
                    session = await Session.start(argv, cwd, self.env(), self.changed)
            except BaseException:
                if job:
                    await job.close()
                raise
            self.sessions[session.id] = session
            self.activity("Installer/Befehl gestartet", shlex.join(argv), key=session.id)
            return {"sessionId": session.id, "instruction": "Mit decky_poll Ausgaben prüfen. Relevante Optionen mit decky_ask erklären und erfragen; nie Passwörter senden."}
        if name == "decky_poll":
            session = self.sessions.get(args.get("sessionId"))
            if not session:
                raise ValueError("Prozesssitzung fehlt.")
            await asyncio.sleep(0.5)
            result = session.snapshot()
            self.activity("Prozess läuft" if result["running"] else "Prozess beendet", result["output"], "running" if result["running"] else "completed", session.id)
            return result
        if name == "decky_input":
            session = self.sessions.get(args.get("sessionId"))
            if not session:
                raise ValueError("Prozesssitzung fehlt.")
            value = args.get("value", "")
            automatic = args.get("automatic") is True and (value == "" or (isinstance(value, str) and value.startswith(str(self.home) + "/") and within(Path(value).resolve(), self.home)))
            if not automatic or session.label.startswith("Root:"):
                await self.ask("approval", "Installerantwort senden?", str(args.get("reason", ""))[:2000] + "\n\nAntwort: " + str(value))
            session.write(value)
            return {"sent": True}
        if name == "decky_storage_scan":
            roots = args.get("roots") or [str(self.home)]
            if not isinstance(roots, list) or not all(isinstance(p, str) for p in roots):
                raise ValueError("Ungültige Scanwurzeln.")
            if any(not within(Path(p).resolve(), self.home) for p in roots):
                await self.ask("approval", "Zusätzliche Verzeichnisse untersuchen?", "\n".join(roots))
            self.activity("Untersucht große Dateien …", "Steam-Spiele und sensible Verzeichnisse werden ausgeschlossen.", key="storage")
            result = await asyncio.to_thread(self.inventory.scan, roots)
            self.activity("Speicheranalyse abgeschlossen", f"{result['visited']} Dateien geprüft; {result['errors']} Zugriffsfehler.", "completed", "storage")
            self.changed()
            return result
        if name == "decky_propose_cleanup":
            rows = self.inventory.selected(args.get("scanId"), args.get("ids", []))
            await self.ask("approval", "Auswahl in den Papierkorb verschieben?", "\n".join(r["path"] for r in rows) + "\n\nPlatz wird erst durch Leeren des Papierkorbs frei. Nichts wird automatisch endgültig gelöscht.")
            result = await asyncio.to_thread(self.inventory.trash, args["scanId"], args["ids"])
            self.activity("In den Papierkorb verschoben", result["notice"], "completed")
            self.changed()
            return result
        raise ValueError("Unbekanntes Werkzeug.")

    async def _reap(self):
        while not self.closed:
            await asyncio.sleep(20)
            for job in list(self.root_jobs):
                if job.session and job.session.process.returncode is not None:
                    await job.close()
                    self.root_jobs.remove(job)
            running = any(s.process.returncode is None for s in self.sessions.values())
            if self.client and not self.busy and not self.requests and not running and time.monotonic() - self.last_activity > 300:
                await self.client.close()
                self.client = None

    async def close(self):
        if self.closed:
            return
        self.closed = True
        self.inventory.cancelled = True
        self.reaper.cancel()
        for request in list(self.requests.values()):
            if not request["future"].done():
                request["future"].cancel()
        for job in self.root_jobs:
            await job.close()
        for session in self.sessions.values():
            await session.stop()
        for task in self.tools_tasks:
            task.cancel()
        if self.client:
            await self.client.close()
        if self.flush_task:
            self.flush_task.cancel()
        if self.db:
            if self.current:
                self.persist(self.chat())
            self.db.close()
        if self.lockfile:
            self.lockfile.close()
