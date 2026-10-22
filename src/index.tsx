import { useEffect, useRef, useState, type ReactNode } from "react";
import { addEventListener, callable, definePlugin, removeEventListener, routerHook } from "@decky/api";
import { ButtonItem, DialogButton, Dropdown, Focusable, Navigation, PanelSection, PanelSectionRow, TextField, ConfirmModal, showModal } from "@decky/ui";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { css } from "./theme";

type Message = { id: string; role: string; text: string; activities?: State["activities"] };
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
let snapshotRequest: Promise<Reply> | undefined;
function publish(s: State) { current = s; listeners.forEach(fn => fn(s)); }
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const result = await backend(method, params);
  if (result.state) publish(result.state);
  if (!result.ok) throw new Error(result.error || "Anfrage fehlgeschlagen");
  return result;
}
function snapshot() {
  if (snapshotRequest) return snapshotRequest;
  snapshotRequest = new Promise<Reply>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Das Backend antwortet nicht. Bitte Decky neu starten oder die aktuelle Release-ZIP erneut installieren. Bleibt der Fehler bestehen, wird das Decky-Codex-Pluginprotokoll benötigt.")), 10000);
    // A read-only request may time out. Never retry mutating actions here.
    Promise.resolve().then(() => backend("snapshot", {})).then(result => {
      if (!result?.state) throw new Error("Das Backend hat keinen gültigen Zustand geliefert.");
      if (!result.ok) throw new Error(result.error || "Backend-Anfrage fehlgeschlagen");
      resolve(result);
    }).catch(reject).finally(() => clearTimeout(timer));
  }).then(result => { publish(result.state); return result; }).finally(() => { snapshotRequest = undefined; });
  return snapshotRequest;
}
function useBackend() {
  const [state, setState] = useState(current);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const retry = async () => {
    setConnecting(true); setError("");
    try { await snapshot(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setConnecting(false); }
  };
  useEffect(() => {
    let mounted = true;
    const receive = (s: State) => { setState(s); setError(""); };
    listeners.add(receive);
    const reconcile = async () => {
      if (mounted) setConnecting(true);
      try { await snapshot(); }
      catch (e) { if (mounted) setError(e instanceof Error ? e.message : String(e)); }
      finally { if (mounted) setConnecting(false); }
    };
    void reconcile();
    // Reconcile only while a UI is mounted. Events provide the live stream.
    const timer = setInterval(() => { void reconcile(); }, 15000);
    return () => { mounted = false; listeners.delete(receive); clearInterval(timer); };
  }, []);
  const act = async (method: string, params: Record<string, unknown> = {}) => {
    setError("");
    try { await rpc(method, params); return true; } catch (e) { setError(e instanceof Error ? e.message : "Anfrage fehlgeschlagen"); return false; }
  };
  return { state, error, act, retry, connecting };
}
const CHAT_ROUTE = "/decky-codex";
const SETTINGS_ROUTE = "/decky-codex/settings";
let selectedModel = "";
type Act = ReturnType<typeof useBackend>["act"];
type IconName = "spark" | "new" | "chats" | "settings" | "back" | "sidebar" | "send" | "stop" | "chevron" | "trash" | "account" | "shield";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    spark: <><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z"/><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7Z"/></>,
    new: <><path d="M12 20H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/><path d="m15 5 4-4 4 4-12 12-5 1 1-5Z"/></>,
    chats: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/>,
    settings: <><path d="m9 3 1-2h4l1 2 3 2 2 1v4l-2 1v3l2 1v4l-3 1-2 2h-4l-1-2-3-2-2-1v-4l2-1V9L3 8V4l3-1Z" transform="translate(1 1) scale(.9)"/><circle cx="12" cy="12" r="3"/></>,
    back: <path d="m14 5-7 7 7 7M7 12h14"/>,
    sidebar: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></>,
    send: <path d="M12 20V4m-6 6 6-6 6 6"/>, stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    trash: <><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
    account: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    shield: <path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Zm-4 9 3 3 5-5"/>,
  };
  return <svg className="dc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function Button({ label, icon, iconOnly = false, className = "", disabled, onClick, children }: {
  label: string; icon?: IconName; iconOnly?: boolean; className?: string; disabled?: boolean; onClick: () => void; children?: ReactNode;
}) {
  return <DialogButton className={`dc-button ${iconOnly ? "dc-icon-button" : ""} ${className}`} disabled={disabled} onClick={onClick}>
    {icon && <Icon name={icon} />}<span className={iconOnly ? "dc-sr-only" : "dc-truncate"}>{label}</span>{children}
  </DialogButton>;
}
function openUrl(url: string) { if (/^https?:\/\//i.test(url)) Navigation.NavigateToExternalWeb(url); }
function go(path: string) { Navigation.Navigate(path); Navigation.CloseSideMenus(); }
function RichText({ text }: { text: string }) {
  return <div className="dc-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={/^https?:\/\//i.test(href || "") ? href : undefined} onClick={e => { e.preventDefault(); if (href) openUrl(href); }}>{children}</a>,
    img: ({ alt }) => <span className="dc-muted">[Bild: {alt || "nicht automatisch geladen"}]</span>,
    table: ({ children }) => <Focusable className="dc-table"><table>{children}</table></Focusable>,
  }}>{text}</Markdown></div>;
}
function Question({ request, act }: { request: Request; act: Act }) {
  const [password, setPassword] = useState("");
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const submit = async (choice: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setSending(true);
    const secret = password; setPassword("");
    try { await act("resolve", { id: request.id, generation: request.generation, choice,
      ...(request.kind === "password" && choice !== "cancel" ? { password: secret } : {}),
      ...(request.kind === "text" ? { text: answer } : {}) }); }
    finally { inFlight.current = false; setSending(false); }
  };
  return <section className={`dc-question ${request.kind === "root" || request.kind === "password" ? "dc-root" : ""}`} aria-label="Deine Entscheidung">
    <div className="dc-request-kind">{request.kind === "password" ? "Lokale Authentifizierung" : request.kind === "question" ? "Codex fragt dich" : "Deine Freigabe"}</div>
    <h3>{request.title}</h3>
    {request.details && <Focusable className="dc-question-details">{request.details}</Focusable>}
    {request.kind === "password" && <TextField label="Linux-Benutzerpasswort" bIsPassword value={password} onChange={e => setPassword(e.target.value)} disabled={sending} />}
    {request.kind === "text" && <TextField label="Deine Antwort" value={answer} onChange={e => setAnswer(e.target.value)} disabled={sending} />}
    {!!request.options.length && <div className="dc-choice-grid">{request.options.map(option => <DialogButton className="dc-button dc-choice" key={option.id} disabled={sending} onClick={() => { void submit(option.id); }}>
      <strong>{option.label}</strong><span className="dc-choice-description">{option.description}</span>
    </DialogButton>)}</div>}
    <div className="dc-actions">
      {!request.options.length && <Button className="dc-primary" disabled={sending || (request.kind === "password" && !password) || (request.kind === "text" && !answer.trim())} label={request.kind === "password" ? "Authentifizieren" : request.kind === "text" ? "Antwort senden" : "Einmal erlauben"} onClick={() => { void submit("accept"); }} />}
      <Button label="Abbrechen / Ablehnen" disabled={sending} onClick={() => { void submit("cancel"); }} />
    </div>
  </section>;
}
function Activity({ state, act }: { state: State; act?: Act }) {
  const [expanded, setExpanded] = useState(false);
  const sessions = act ? state.sessions : [];
  if (!state.activities.length && !sessions.length && !state.busy) return null;
  const working = state.activities.filter(a => a.status === "running");
  const title = state.requests.length ? "Wartet auf deine Entscheidung" : state.busy ? (working[working.length - 1]?.title || "Denkt nach …") : "Aktivitäten – technische Details";
  return <div className="dc-activity">
    <DialogButton className="dc-button dc-activity-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {state.busy ? <span className="dc-dot" /> : <Icon name="spark" />}<span>{title}</span><span className={`dc-chevron ${expanded ? "dc-open" : ""}`}><Icon name="chevron" /></span>
    </DialogButton>
    {expanded && <div>{state.activities.map(a => <section className="dc-step" key={a.id}>
      <strong>{a.status === "running" ? "◌ " : a.status === "failed" ? "! " : "✓ "}{a.title}</strong>
      {a.details && <Focusable><pre>{a.details}</pre></Focusable>}
    </section>)}{sessions.map(session => <section className="dc-step" key={session.id}>
      <strong>{session.running ? "Läuft: " : `Exit ${session.exitCode}: `}{session.label}</strong><Focusable><pre>{session.output || "Noch keine Ausgabe."}</pre></Focusable>
      {session.running && <Button label="Prozess stoppen" icon="stop" onClick={() => { void act!("stop_session", { id: session.id }); }} />}
    </section>)}</div>}
  </div>;
}
function Startup({ connection }: { connection: ReturnType<typeof useBackend> }) {
  return <div className="dc dc-app dc-startup"><style>{css}</style><div><Icon name="spark" /><h1>Decky Codex</h1>
    <p role={connection.error ? "alert" : "status"}>{connection.error || "Verbindung wird hergestellt …"}</p>
    <Button className="dc-secondary" label="Erneut verbinden" disabled={connection.connecting} onClick={() => { void connection.retry(); }} />
    {connection.error && <p className="dc-muted">Pluginprotokoll: homebrew/logs/Decky Codex</p>}
  </div></div>;
}
function Chat() {
  const connection = useBackend();
  const { state, error, act } = connection;
  const [view, setView] = useState<"chat" | "history">("chat");
  const [sidebar, setSidebar] = useState(true);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const chatId = state?.chat?.id || "new";
  useEffect(() => { setDraft(drafts.get(chatId) || ""); setTitle(state?.chat?.title || ""); follow.current = true; }, [chatId]);
  useEffect(() => { if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [state?.chat?.messages.map(m => m.text).join(""), view]);
  const send = async () => {
    if (!draft.trim() || !state || state.busy || inFlight.current) return;
    inFlight.current = true; setSending(true);
    const text = draft;
    setDraft(""); drafts.delete(chatId);
    try {
      const ok = await act("send", { text, model: selectedModel, nonce: crypto.randomUUID() });
      if (!ok) { setDraft(text); drafts.set(chatId, text); }
    } finally { inFlight.current = false; setSending(false); }
  };
  const chooseChat = async (id?: string) => {
    if (await act(id ? "open_chat" : "new_chat", id ? { id } : {})) setView("chat");
  };
  if (!state) return <Startup connection={connection} />;
  const running = state.busy || state.sessions.some(s => s.running);
  return <Focusable className="dc dc-app" onCancel={() => Navigation.NavigateBack()}>
    <style>{css}</style>
    <aside className={`dc-sidebar ${sidebar ? "" : "dc-collapsed"}`} aria-label="Chats und Navigation">
      <div className="dc-brand">{sidebar && <span>Decky Codex</span>}<Button label={sidebar ? "Seitenleiste einklappen" : "Seitenleiste öffnen"} icon="sidebar" iconOnly onClick={() => setSidebar(!sidebar)} /></div>
      <Button className="dc-nav-button" label="Neuer Chat" icon="new" iconOnly={!sidebar} disabled={state.busy || sending} onClick={() => { void chooseChat(); }} />
      <Button className={`dc-nav-button ${view === "history" ? "dc-selected" : ""}`} label="Alle Chats" icon="chats" iconOnly={!sidebar} onClick={() => setView(view === "history" ? "chat" : "history")} />
      {sidebar && <div className="dc-recent"><div className="dc-nav-label">Letzte Chats</div>{state.chats.slice(0, 12).map(chat => <Button key={chat.id} className={view === "chat" && chat.id === state.chat?.id ? "dc-selected" : ""} label={chat.title} disabled={state.busy || sending} onClick={() => { void chooseChat(chat.id); }} />)}{!state.chats.length && <p className="dc-muted" style={{ padding: "0 12px" }}>Deine Gespräche erscheinen hier.</p>}</div>}
      <div className="dc-sidebar-bottom"><Button label="Einstellungen" icon="settings" iconOnly={!sidebar} onClick={() => go(SETTINGS_ROUTE)} /><Button label="Zurück zu Steam" icon="back" iconOnly={!sidebar} onClick={() => Navigation.NavigateBack()} /></div>
    </aside>
    <main className="dc-main" aria-label={view === "history" ? "Chatverlauf" : "Gespräch"}>
      <header className="dc-topbar"><div className="dc-product"><span>Codex</span><span className="dc-chat-title dc-truncate">{view === "history" ? "Deine Gespräche" : state.chat?.title || "Neuer Chat"}</span></div><span className="dc-badge">STEAM DECK</span></header>
      {(error || state.error) && <div className="dc-column" style={{ padding: "0 20px" }}><div className="dc-notice" role="alert">{error || state.error}</div></div>}
      {view === "history" ? <div className="dc-page-scroll"><div className="dc-page"><div className="dc-page-heading"><h1>Deine Chats</h1><p>Öffne ein Gespräch oder beginne etwas Neues.</p></div>
        {!!state.requests.length && <div className="dc-banner"><span>Codex wartet auf deine Entscheidung.</span><Button label="Entscheidung öffnen" onClick={() => setView("chat")} /></div>}
        {state.chats.map(chat => <div className="dc-history-row" key={chat.id}><Button label={chat.title} icon="chats" disabled={state.busy || sending} onClick={() => { void chooseChat(chat.id); }} /><Button label={`Chat löschen: ${chat.title}`} icon="trash" iconOnly disabled={state.busy || sending} onClick={() => { showModal(<ConfirmModal strTitle="Chat löschen?" strDescription={`Chat „${chat.title}“ einschließlich Codex-Verlauf löschen?`} onOK={() => { void act("delete_chat", { id: chat.id }); }} />); }} /></div>)}
        {!state.chats.length && <p className="dc-muted">Noch keine Gespräche gespeichert.</p>}
        {state.chat && <section className="dc-setting-section" style={{ marginTop: 28 }}><h2>Aktuellen Chat umbenennen</h2><TextField label="Chattitel" value={title} onChange={e => setTitle(e.target.value)} /><div className="dc-actions"><Button label="Titel speichern" disabled={state.busy || !title.trim()} onClick={() => { void act("rename_chat", { id: state.chat!.id, title }); }} /></div></section>}
      </div></div> : <div className="dc-chat-body">
        <div className="dc-transcript" ref={scroll} onScroll={e => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; }}>
          <div className="dc-column">
            {!state.account && <div className="dc-banner"><span>Verbinde dein ChatGPT-Konto, um loszulegen.</span><Button label="Konto verbinden" onClick={() => go(SETTINGS_ROUTE)} /></div>}
            {state.chat?.messages.map(message => message.role === "activity" ? <Activity key={message.id} state={{ ...state, busy: false, requests: [], sessions: [], activities: message.activities || [] }} /> : <article key={message.id} className={`dc-message ${message.role === "user" ? "dc-user" : "dc-assistant"}`}>
              {message.role !== "user" && <div className="dc-assistant-name"><Icon name="spark" />Codex</div>}<RichText text={message.text} />
            </article>)}
            {!!state.chat?.messages.length && <Activity state={state} act={act} />}
          </div>
          {!state.chat?.messages.length && <div className="dc-empty"><div className="dc-empty-symbol"><Icon name="spark" /></div><h1>Wobei kann ich dir helfen?</h1><p>Stell eine Frage oder gib deinem Steam Deck eine Aufgabe.</p>{running && <Activity state={state} act={act} />}</div>}
        </div>
        {!!state.requests.length && <div className="dc-request-tray" aria-label="Wartende Entscheidungen">{state.requests.map(request => <Question key={request.id} request={request} act={act} />)}</div>}
        <footer className="dc-composer-area"><div className="dc-column"><div className="dc-composer">
          <div className="dc-native-input">{!draft && <span className="dc-input-placeholder" aria-hidden="true">Frag Codex etwas …</span>}<TextField label={<span className="dc-sr-only">Nachricht an Codex</span>} value={draft} disabled={state.busy || sending} onChange={e => { setDraft(e.target.value); drafts.set(chatId, e.target.value); }} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} /></div>
          {running ? <Button className="dc-primary dc-send" label="Aufgabe stoppen" icon="stop" iconOnly onClick={() => { void act("interrupt"); }} /> : <Button className="dc-primary dc-send" label="Nachricht senden" icon="send" iconOnly disabled={sending || !draft.trim()} onClick={() => { void send(); }} />}
        </div><p className="dc-composer-hint">A im Eingabefeld: Steam-Tastatur · Strg + Enter: senden · Änderungen werden vorab bestätigt.</p></div></footer>
      </div>}
    </main>
  </Focusable>;
}
function Settings() {
  const connection = useBackend();
  const { state, error, act } = connection;
  const [model, setModel] = useState(selectedModel);
  // Opening account settings is an explicit read of the cached sign-in status.
  useEffect(() => { void act("refresh_account"); }, []);
  if (!state) return <Startup connection={connection} />;
  return <Focusable className="dc dc-app" onCancel={() => Navigation.NavigateBack()}><style>{css}</style><main className="dc-settings-shell" aria-label="Einstellungen">
    <header className="dc-settings-header"><Button label="Zurück zum Chat" icon="back" onClick={() => Navigation.NavigateBack()} /><span className="dc-muted">Decky Codex · {state.version}</span></header>
    <div className="dc-page-scroll"><div className="dc-page"><div className="dc-page-heading"><h1>Einstellungen</h1><p>Konto, Modell und Freigaben für deinen Assistenten.</p></div>
      {(error || state.error) && <div className="dc-notice" role="alert">{error || state.error}</div>}
      {!!state.requests.length && <div className="dc-banner"><span>Codex wartet auf deine Entscheidung.</span><Button label="Entscheidung öffnen" onClick={() => Navigation.NavigateBack()} /></div>}
      <div className="dc-settings-grid">
        <section className="dc-setting-section"><h2><Icon name="account" />ChatGPT-Konto</h2><div className="dc-account"><div className="dc-avatar">{state.account?.email?.slice(0, 1).toUpperCase() || <Icon name="account" />}</div><div><strong>{state.account ? "Verbunden" : "Nicht verbunden"}</strong><p>{state.account?.email || "Melde dich mit deinem ChatGPT-Konto an."}</p></div></div>
          <div className="dc-actions">{!state.account ? <Button className="dc-primary" label="Mit ChatGPT anmelden" onClick={() => { void act("login"); }} /> : <Button className="dc-secondary" label="Abmelden" disabled={state.busy} onClick={() => { void act("logout"); }} />}<Button label="Status prüfen" onClick={() => { void act("refresh_account"); }} /></div>
          {state.login && <div className="dc-login"><h3>Anmeldung bestätigen</h3><p>Öffne diese Adresse auf deinem Smartphone oder Steam Deck:</p><p style={{ overflowWrap: "anywhere" }}>{state.login.verificationUrl || state.login.authUrl}</p><code className="dc-code">{state.login.userCode}</code><Button className="dc-secondary" label="Anmeldeseite öffnen" onClick={() => openUrl(state.login!.verificationUrl || state.login!.authUrl || "")} /><p style={{ marginTop: 12 }}>Falls die Freigabe fehlt: ChatGPT im Webbrowser öffnen → Einstellungen → Sicherheit → Anmeldung per Gerätecode.</p></div>}
        </section>
        <section className="dc-setting-section"><h2><Icon name="spark" />Modell</h2><p>Wähle das Modell für deine nächsten Nachrichten.</p><div style={{ marginTop: 18 }}>{state.models.length ? <Dropdown rgOptions={state.models.map(m => ({ data: m.model || m.id, label: m.displayName || m.model || m.id }))} selectedOption={model || (state.models.find(m => m.isDefault)?.model || state.models[0].model || state.models[0].id)} onChange={o => { const value = String(o.data); selectedModel = value; setModel(value); }} /> : <p className="dc-muted">Verfügbare Modelle erscheinen nach der Anmeldung.</p>}</div><p style={{ marginTop: 20 }}>Es gelten die Kontingente deines ChatGPT-Kontos. Es erfolgt kein automatischer Wechsel zu einer kostenpflichtigen API.</p></section>
        <section className="dc-setting-section dc-wide"><h2><Icon name="shield" />Deine Kontrolle</h2><p>Codex erklärt geplante Änderungen und fragt im Chat nach deiner Freigabe. Administratoraktionen benötigen zusätzlich dein Linux-Passwort in einem getrennten lokalen Eingabefeld.</p><p>Codex verarbeitet Anfragen online. Datei- und Befehlsausgaben, die für deine Aufgabe verwendet werden, können an OpenAI übermittelt werden. Chats werden lokal auf deinem Steam Deck gespeichert.</p></section>
      </div><p className="dc-settings-footnote">Vorschau · Deine Freigabe gilt jeweils nur für die angezeigte Aktion.</p>
    </div></div>
  </main></Focusable>;
}
function Panel() {
  const { state, error } = useBackend();
  return <PanelSection title="Decky Codex"><PanelSectionRow><div style={{ paddingBottom: 12 }}>{error || (!state ? "Verbindung wird hergestellt …" : state.requests.length ? "Deine Entscheidung wird benötigt" : state.busy ? "Codex arbeitet …" : "Dein Assistent auf dem Steam Deck")}</div><ButtonItem layout="below" onClick={() => go(CHAT_ROUTE)}>Chat öffnen</ButtonItem></PanelSectionRow></PanelSection>;
}
export default definePlugin(() => {
  const listener = addEventListener<[State]>("decky_codex_state", publish);
  routerHook.addRoute(CHAT_ROUTE, Chat, { exact: true });
  routerHook.addRoute(SETTINGS_ROUTE, Settings, { exact: true });
  return { name: "Decky Codex", titleView: <div>Decky Codex</div>, icon: <Icon name="spark" />, content: <Panel />,
    onDismount() { removeEventListener("decky_codex_state", listener); routerHook.removeRoute(CHAT_ROUTE); routerHook.removeRoute(SETTINGS_ROUTE); listeners.clear(); current = undefined; drafts.clear(); selectedModel = ""; } };
});
