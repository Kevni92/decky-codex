import { useEffect, useRef, useState } from "react";
import { addEventListener, callable, definePlugin, removeEventListener, routerHook } from "@decky/api";
import { ButtonItem, DialogButton, Dropdown, Focusable, Navigation, PanelSection, PanelSectionRow, TextField, ConfirmModal, showModal } from "@decky/ui";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Message = { id: string; role: string; text: string };
type Request = { id: string; kind: string; title: string; details: string; generation: string; options: { id: string; label: string; description: string; value: string }[] };
type Row = { id: string; name: string; path: string; bytes: number; logicalBytes: number; category: string };
type State = {
  generation: string; version: string; busy: boolean; error: string;
  account: null | { type: string; email?: string; planType?: string };
  login: null | { verificationUrl?: string; userCode?: string; authUrl?: string };
  chat: null | { id: string; title: string; messages: Message[] };
  chats: { id: string; title: string; updated: number }[];
  models: { id: string; model: string; displayName: string; isDefault: boolean }[];
  requests: Request[];
  activities: { id: string; title: string; details: string; status: string }[];
  sessions: { id: string; label: string; output: string; running: boolean; exitCode: number | null }[];
  inventory: null | { id: string; rows: Row[]; warnings: string[]; errors: number; metric: string; visited: number };
};
type Reply = { ok: boolean; error?: string; state: State };
const backend = callable<[method: string, params: Record<string, unknown>], Reply>("dispatch");
const listeners = new Set<(s: State) => void>();
const drafts = new Map<string, string>();
let current: State | undefined;
function publish(s: State) { current = s; listeners.forEach(fn => fn(s)); }
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const result = await backend(method, params);
  if (result.state) publish(result.state);
  if (!result.ok) throw new Error(result.error || "Anfrage fehlgeschlagen");
  return result;
}
function useBackend() {
  const [state, setState] = useState(current);
  const [error, setError] = useState("");
  useEffect(() => {
    listeners.add(setState);
    rpc("snapshot").catch(e => setError(String(e.message)));
    // Reconcile only while a UI is mounted. Events provide the live stream.
    const timer = setInterval(() => { rpc("snapshot").catch(() => {}); }, 8000);
    return () => { listeners.delete(setState); clearInterval(timer); };
  }, []);
  const act = async (method: string, params: Record<string, unknown> = {}) => {
    setError("");
    try { await rpc(method, params); } catch (e) { setError(e instanceof Error ? e.message : "Anfrage fehlgeschlagen"); }
  };
  return { state, error, act };
}
const css = `
.dc{color:#e9eef5;font:16px/1.55 system-ui,sans-serif;--dc-muted:#a8b4c3;--dc-border:#344353}
.dc *{box-sizing:border-box}.dc h1,.dc h2,.dc h3{line-height:1.3}.dc h1{font-size:26px}.dc h2{font-size:22px}.dc h3{font-size:19px}
.dc pre{white-space:pre-wrap;word-break:break-word;background:#101822;border-radius:8px;padding:12px;font:13px/1.5 monospace;max-height:280px;overflow:auto}
.dc code{font-size:.9em;color:#b5e3ec}.dc blockquote{border-left:3px solid #65c8dc;padding-left:14px;margin-left:0;color:#bdcbd8}
.dc a{color:#83d9ec}.dc table{border-collapse:collapse;width:100%;font-size:14px}.dc th{background:#233446;text-align:left;color:#d6f3fb}
.dc th,.dc td{padding:10px 12px;border-bottom:1px solid var(--dc-border);vertical-align:top}.dc tr:nth-child(even){background:#1b2733}.dc td{overflow-wrap:anywhere}
.dc .dc-table{overflow:auto;max-width:100%}.dc .dc-card{background:#1c2937;border:1px solid var(--dc-border);border-radius:12px;padding:16px;margin:12px 0}
.dc .dc-question{border-color:#70c9e1}.dc .dc-warning{border-color:#dcad68}.dc .dc-user{background:#263b4b;margin-left:10%;border-color:#426075}
.dc .dc-message{padding:14px 18px;margin:16px 0;border-radius:12px;overflow-wrap:anywhere}.dc .dc-muted{color:var(--dc-muted);font-size:13px}
.dc .dc-buttons{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.dc .dc-buttons>*{flex:1;min-width:135px}.dc .dc-size{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.dc .dc-step{padding:10px 0;border-bottom:1px solid var(--dc-border)}.dc .dc-step:last-child{border:0}.dc .dc-role{color:#95cbd7;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.dc .dc-dot{display:inline-block;width:8px;height:8px;background:#71d2e1;border-radius:50%;margin-right:8px;animation:dc-pulse 1.5s infinite}
@keyframes dc-pulse{50%{opacity:.3}}@media(prefers-reduced-motion:reduce){.dc .dc-dot{animation:none}}
`;
function openUrl(url: string) { if (/^https?:\/\//i.test(url)) Navigation.NavigateToExternalWeb(url); }
function RichText({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={/^https?:\/\//i.test(href || "") ? href : undefined} onClick={e => { e.preventDefault(); if (href) openUrl(href); }}>{children}</a>,
    img: ({ alt }) => <span className="dc-muted">[Bild: {alt || "nicht automatisch geladen"}]</span>,
    table: ({ children }) => <Focusable className="dc-table"><table>{children}</table></Focusable>,
  }}>{text}</Markdown>;
}
function Question({ request, act }: { request: Request; act: (m: string, p?: Record<string, unknown>) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async (choice: string) => {
    setSending(true);
    const secret = password;
    setPassword("");
    try { await act("resolve", { id: request.id, generation: request.generation, choice,
      ...(request.kind === "password" && choice !== "cancel" ? { password: secret } : {}),
      ...(request.kind === "text" ? { text: answer } : {}) }); }
    finally { setSending(false); }
  };
  return <section className={`dc-card dc-question ${request.kind === "root" ? "dc-warning" : ""}`}>
    <div className="dc-role">{request.kind === "password" ? "Lokale Authentifizierung" : "Deine Entscheidung"}</div>
    <h3>{request.title}</h3>
    <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{request.details}</div>
    {request.kind === "password" && <TextField label="Linux-Benutzerpasswort" bIsPassword value={password} onChange={e => setPassword(e.target.value)} disabled={sending} />}
    {request.kind === "text" && <TextField label="Antwort" value={answer} onChange={e => setAnswer(e.target.value)} disabled={sending} />}
    <div className="dc-buttons"><DialogButton disabled={sending} onClick={() => submit("cancel")}>Abbrechen / Ablehnen</DialogButton>
      {!request.options.length && <DialogButton disabled={sending || (request.kind === "password" && !password)} onClick={() => submit("accept")}>{request.kind === "password" ? "Authentifizieren" : request.kind === "text" ? "Antwort senden" : "Einmal erlauben"}</DialogButton>}
    </div>
    {request.options.map(option => <div key={option.id} style={{ marginTop: 12 }}>
      <DialogButton style={{ width: "100%" }} disabled={sending} onClick={() => submit(option.id)}>{option.label}</DialogButton>
      <p className="dc-muted">{option.description}</p>
    </div>)}
  </section>;
}
function Activity({ state }: { state: State }) {
  const [expanded, setExpanded] = useState(false);
  if (!state.activities.length) return null;
  const working = state.activities.filter(a => a.status === "running");
  const title = state.requests.length ? (state.requests[0].kind === "question" ? "Deine Entscheidung erforderlich" : "Bestätigung erforderlich")
    : state.busy ? (working[working.length - 1]?.title || "Denkt nach …") : "Aktivitäten – technische Details";
  return <div className="dc-card">
    <DialogButton style={{ width: "100%", textAlign: "left" }} onClick={() => setExpanded(!expanded)}>
      {state.busy && <span className="dc-dot" />}{expanded ? "▾ " : "▸ "}{title}
    </DialogButton>
    {expanded && state.activities.map(a => <section className="dc-step" key={a.id}>
      <strong>{a.status === "running" ? "◌ " : a.status === "failed" ? "! " : "✓ "}{a.title}</strong>
      {a.details && <Focusable><pre>{a.details}</pre></Focusable>}
    </section>)}
  </div>;
}
function bytes(n: number) { return `${(n / 1024 ** 3).toLocaleString("de-DE", { maximumFractionDigits: 2 })} GiB`; }
function InventoryView({ state, act }: { state: State; act: (m: string, p?: Record<string, unknown>) => Promise<void> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const inventory = state.inventory;
  useEffect(() => { setSelected(new Set()); }, [inventory?.id]);
  if (!inventory) return null;
  return <section className="dc-card">
    <h3>Große Dateien außerhalb von Steam-Spielen</h3>
    <p className="dc-muted">{inventory.metric} · {inventory.visited} Dateien geprüft · {inventory.errors} Zugriffsfehler</p>
    {inventory.warnings.map((w, i) => <p key={i} style={{ color: "#f2c58b" }}>{w}</p>)}
    <Focusable className="dc-table"><table><thead><tr><th>Auswahl</th><th>Name / Pfad</th><th className="dc-size">Größe</th><th>Einordnung</th></tr></thead>
      <tbody>{inventory.rows.map(row => <tr key={row.id}>
        <td><DialogButton onClick={() => { const next = new Set(selected); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); setSelected(next); }}>{selected.has(row.id) ? "☑" : "☐"}</DialogButton></td>
        <td><strong>{row.name}</strong><div className="dc-muted">{row.path}</div></td>
        <td className="dc-size">{bytes(row.bytes)}</td><td>{row.category}</td>
      </tr>)}</tbody></table></Focusable>
    {!inventory.rows.length && <p>Keine Dateien über 1 MiB im untersuchten Bereich gefunden.</p>}
    <div className="dc-buttons"><DialogButton disabled={!selected.size} onClick={() => act("cleanup", { scanId: inventory.id, ids: [...selected] })}>Auswahl in Papierkorb …</DialogButton></div>
    <p className="dc-muted">Dateien werden erneut geprüft. Eine separate Bestätigung folgt. Der Papierkorb gibt Speicher erst beim Leeren frei.</p>
  </section>;
}
function Chat() {
  const { state, error, act } = useBackend();
  const [view, setView] = useState("chat");
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("");
  const [title, setTitle] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const chatId = state?.chat?.id || "new";
  useEffect(() => { setDraft(drafts.get(chatId) || ""); setTitle(state?.chat?.title || ""); }, [chatId]);
  useEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [state?.chat?.messages.map(m => m.text).join("")]);
  const send = async () => {
    if (!draft.trim()) return;
    const text = draft;
    setDraft(""); drafts.delete(chatId);
    try { await rpc("send", { text, model, nonce: crypto.randomUUID() }); }
    catch { setDraft(text); drafts.set(chatId, text); }
  };
  if (!state) return <div className="dc" style={{ padding: 60 }}><style>{css}</style><h2>Decky Codex</h2><p>{error || "Verbindung wird hergestellt …"}</p></div>;
  return <div className="dc" style={{ padding: "52px 32px 20px", height: "100vh", overflowY: "auto", background: "#131e29" }}>
    <style>{css}</style>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
      <div><h1 style={{ margin: 0 }}>Decky Codex <span className="dc-muted">Preview {state.version}</span></h1><div className="dc-muted">{state.account ? `Angemeldet${state.account.email ? ` · ${state.account.email}` : ""}` : "Dein Assistent auf dem Steam Deck"}</div></div>
      <div className="dc-buttons"><DialogButton onClick={() => setView(view === "history" ? "chat" : "history")}>Verlauf</DialogButton><DialogButton onClick={() => setView(view === "settings" ? "chat" : "settings")}>Einstellungen</DialogButton><DialogButton onClick={() => Navigation.NavigateBack()}>Zurück</DialogButton></div>
    </header>
    {(error || state.error) && <div className="dc-card dc-warning">{error || state.error}</div>}
    {state.requests.map(request => <Question key={request.id} request={request} act={act} />)}
    {view === "settings" ? <section className="dc-card"><h2>Konto und Einrichtung</h2>
      <p>Codex verarbeitet Anfragen online über OpenAI. Freigegebene Datei- und Befehlsausgaben können Teil des Modellkontexts werden. Es gelten die Kontingente deines Kontos; kein automatischer API-Fallback.</p>
      <div className="dc-buttons"><DialogButton onClick={() => act("refresh_account")}>Kontostatus prüfen</DialogButton><DialogButton onClick={() => act("login")}>Mit ChatGPT anmelden</DialogButton><DialogButton disabled={state.busy} onClick={() => act("logout")}>Abmelden</DialogButton></div>
      {state.login && <div className="dc-card"><h3>Anmeldung bestätigen</h3><p>Öffne die offizielle Adresse am Deck oder auf deinem Smartphone:</p><p>{state.login.verificationUrl || state.login.authUrl}</p><h2>{state.login.userCode}</h2><DialogButton onClick={() => openUrl(state.login!.verificationUrl || state.login!.authUrl || "")}>Anmeldeseite öffnen</DialogButton><p className="dc-muted">Gerätecode-Anmeldung gegebenenfalls in den ChatGPT-Sicherheitseinstellungen erlauben.</p></div>}
      <p>Host-Befehle werden einzeln bestätigt. Root-Aufträge benötigen zusätzlich dein Linux-Benutzerpasswort in einem getrennten lokalen Dialog. Die native Codex-Ausführung startet lesend.</p>
      <p className="dc-muted">Native Runtime 0.163.0 · Linux x86_64 · Kein Desktop-/Steam-Deck-Hardwaretest in dieser Vorschau.</p>
    </section> : view === "history" ? <section className="dc-card"><h2>Chatverlauf</h2><DialogButton disabled={state.busy} onClick={async () => { await act("new_chat"); setView("chat"); }}>Neuer Chat</DialogButton>
      {state.chats.map(chat => <div className="dc-buttons" key={chat.id}><DialogButton disabled={state.busy} onClick={async () => { await act("open_chat", { id: chat.id }); setView("chat"); }}>{chat.title}</DialogButton><DialogButton disabled={state.busy} onClick={() => { showModal(<ConfirmModal strTitle="Chat löschen?" strDescription={`Chat „${chat.title}“ einschließlich Codex-Verlauf löschen?`} onOK={() => { void act("delete_chat", { id: chat.id }); }} />); }}>Löschen …</DialogButton></div>)}
      {state.chat && <><TextField label="Titel des aktuellen Chats" value={title} onChange={e => setTitle(e.target.value)} /><DialogButton onClick={() => act("rename_chat", { id: state.chat!.id, title })}>Titel speichern</DialogButton></>}
    </section> : <>
      <div className="dc-buttons"><DialogButton disabled={state.busy} onClick={() => act("new_chat")}>Neuer Chat</DialogButton><DialogButton onClick={() => act("scan")}>Große Dateien untersuchen</DialogButton><DialogButton onClick={() => act("cancel_scan")}>Scan stoppen</DialogButton></div>
      {!state.account && <div className="dc-card"><p>Verbinde deinen ChatGPT-Account, um mit Codex zu arbeiten. Die lokale Speicheranalyse kannst du bereits verwenden.</p><DialogButton onClick={() => { setView("settings"); void act("refresh_account"); }}>Konto einrichten</DialogButton></div>}
      <div ref={scroll} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} style={{ maxHeight: "45vh", overflowY: "auto", paddingRight: 8 }}>
        {state.chat?.messages.map(message => <article key={message.id} className={`dc-message ${message.role === "user" ? "dc-user" : ""}`}><div className="dc-role">{message.role === "user" ? "Du" : "Codex"}</div><RichText text={message.text} /></article>)}
      </div>
      <Activity state={state} />
      {state.sessions.map(session => <div className="dc-card" key={session.id}><strong>{session.running ? "◌ Läuft: " : `Exit ${session.exitCode}: `}{session.label}</strong><Focusable><pre>{session.output || "Noch keine Ausgabe."}</pre></Focusable>{session.running && <DialogButton onClick={() => act("stop_session", { id: session.id })}>Prozess stoppen</DialogButton>}</div>)}
      <InventoryView state={state} act={act} />
      {state.models.length > 0 && <Dropdown rgOptions={state.models.map(m => ({ data: m.model || m.id, label: m.displayName || m.model || m.id }))} selectedOption={model || (state.models.find(m => m.isDefault)?.model || state.models[0].model || state.models[0].id)} onChange={o => setModel(String(o.data))} />}
      <TextField label="Deine Nachricht" value={draft} disabled={state.busy} onChange={e => { setDraft(e.target.value); drafts.set(chatId, e.target.value); }} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
      <div className="dc-buttons"><DialogButton disabled={state.busy || !draft.trim()} onClick={send}>Senden</DialogButton><DialogButton disabled={!state.busy && !state.sessions.some(s => s.running)} onClick={() => act("interrupt")}>Aufgabe stoppen</DialogButton></div>
    </>}
  </div>;
}
function Panel() {
  const { state } = useBackend();
  return <PanelSection title="Decky Codex"><PanelSectionRow><div style={{ paddingBottom: 12 }}>{state?.requests.length ? "Deine Entscheidung wird benötigt" : state?.busy ? "Codex arbeitet …" : "Bereit für deine nächste Aufgabe"}</div><ButtonItem layout="below" onClick={() => { Navigation.Navigate("/decky-codex"); Navigation.CloseSideMenus(); }}>Chat öffnen</ButtonItem></PanelSectionRow></PanelSection>;
}
export default definePlugin(() => {
  const listener = addEventListener<[State]>("decky_codex_state", publish);
  routerHook.addRoute("/decky-codex", Chat);
  return { name: "Decky Codex", titleView: <div>Decky Codex</div>, icon: <span aria-hidden>✦</span>, content: <Panel />,
    onDismount() { removeEventListener("decky_codex_state", listener); routerHook.removeRoute("/decky-codex"); listeners.clear(); current = undefined; drafts.clear(); } };
});
