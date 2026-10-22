// A simulated Steam/Decky host for testing the real compiled plugin.
// TextField uses Steam's real label/wrapper structure. Its automatic keyboard
// context intentionally does nothing; the plugin must resolve the owning window.
import React from "react";
import { createRoot } from "react-dom/client";
import * as jsx from "react/jsx-runtime";
const h = React.createElement;
const routes = new Map();
const backstack = ["/decky-codex"];
let event;
let root;
const calls = [];
const state = {
  generation: "ui-test", version: "0.1.0", busy: false, error: "", login: null,
  account: { type: "chatgpt", email: "test@example.invalid" },
  models: [{ id: "default", model: "default", displayName: "Standardmodell", isDefault: true }, { id: "other", model: "other", displayName: "Anderes Modell" }],
  chats: [{ id: "chat", title: "Speicher prüfen", updated: 0 }],
  chat: { id: "chat", title: "Speicher prüfen", messages: [
    { id: "u", role: "user", text: "Welche Dateien brauchen viel Platz?" },
    { id: "a", role: "assistant", text: "## Speicherübersicht\n\nSteam-Spiele bleiben ausgeschlossen.\n\n| Name | Größe |\n| --- | ---: |\n| Archiv.zip | 2,4 GiB |\n| Aufnahme.mp4 | 1,8 GiB |\n\n<img src=x onerror=alert(1)>" }
  ] },
  activities: [{ id: "step", title: "Speicheranalyse abgeschlossen", details: "Exakter Werkzeugschritt: 42 Dateien geprüft", status: "completed" }],
  sessions: [], requests: [], inventory: null
};
const render = path => { const component = [...routes].find(([candidate, entry]) => entry.exact ? candidate === path : path.startsWith(candidate))?.[1].component; if (!component) throw Error("Unknown route: " + path); window.__test.path = path; root.render(h(component)); };
window.__test = {
  calls, state, path: "/decky-codex", keyboardActivations: 0, keyboardHides: 0, keyboardProps: null, keyboardRef: null, keyboardOpen: false,
  transport: new URLSearchParams(location.search).get("transport"),
  publish() { event?.({ ...state }); },
  request(kind) {
    state.requests = [{ id: "req", generation: "ui-test", kind, title: kind === "password" ? "Linux-Benutzerpasswort" : "X oder Y?", details: "Erklärung der Auswirkungen", options: kind === "question" ? [{ id: "x", value: "X", label: "Lokale Installation", description: "Nur für diesen Benutzer" }, { id: "y", value: "Y", label: "Systemweite Installation", description: "Benötigt Administratorrechte" }] : [] }];
    event?.({ ...state });
  }
};
let activeKeyboard = null;
const manager = {
  CreateVirtualKeyboardRef(props) {
    const ref = {
      SetAsCurrentVirtualKeyboardTarget() { activeKeyboard = ref; window.__test.keyboardProps = props; window.__test.keyboardRef = ref; },
      ShowVirtualKeyboard() { if (window.__test.keyboardUnavailable) throw Error("Test: Steam keyboard unavailable"); if (!props.BIsElementValidForInput()) throw Error("Input is not focused"); ref.SetAsCurrentVirtualKeyboardTarget(); window.__test.keyboardActivations++; window.__test.keyboardOpen = true; },
      HideVirtualKeyboard() { if (activeKeyboard === ref) { window.__test.keyboardHides++; window.__test.keyboardOpen = false; } },
      BIsActive() { return activeKeyboard === ref && window.__test.keyboardOpen; }
    };
    return ref;
  }
};
const steamWindow = { BrowserWindow: window, VirtualKeyboardManager: manager };
const steamRouter = { WindowStore: {
  GetWindowInstanceFromWindow: view => view === window ? steamWindow : null,
  GamepadUIMainWindowInstance: { BrowserWindow: {}, VirtualKeyboardManager: { CreateVirtualKeyboardRef() { throw Error("Wrong Steam window"); } } }
} };
const api = {
  _version: 2,
  callable: () => async (method, params) => {
    calls.push({ method, params: method === "resolve" ? { ...params, password: params.password ? "[redacted]" : undefined } : params });
    if (method === "snapshot" && window.__test.transport === "hang") return new Promise(() => {});
    if (method === "snapshot" && window.__test.transport === "reject") throw new Error("Backend-Start fehlgeschlagen: ModuleNotFoundError: example_missing_module");
    if (method === "send" && window.__test.failSend) return { ok: false, error: "Senden fehlgeschlagen", state: { ...state } };
    if (method === "resolve") state.requests = [];
    if (method === "send") state.chat.messages.push({ id: "sent", role: "user", text: params.text });
    if (method === "new_chat") { state.chat = { id: "new-chat", title: "Neuer Chat", messages: [] }; state.activities = []; }
    return { ok: true, state: { ...state } };
  },
  addEventListener: (_, handler) => { event = handler; return handler; },
  removeEventListener() {},
  routerHook: { addRoute: (path, component, props = {}) => routes.set(path, { component, exact: props.exact }), removeRoute(path) { routes.delete(path); } }
};
const Button = ({ children, onClick, disabled, style, className, ...props }) => h("button", { onClick, disabled, style, className, "aria-expanded": props["aria-expanded"] }, children);
window.SP_REACT = React;
window.SP_JSX = jsx;
window.DFL = {
  DialogButton: Button, ButtonItem: Button,
  PanelSection: ({ children }) => h("section", {}, children), PanelSectionRow: ({ children }) => h("div", {}, children),
  Focusable: React.forwardRef(({ children, onActivate, onCancel, noFocusRing, focusClassName, focusWithinClassName, ...props }, ref) => h("div", { ...props, ref, tabIndex: 0, onKeyDown: e => { if (e.key === "Escape") { e.stopPropagation(); onCancel?.(e); } else if (e.key === "Enter" && e.target === e.currentTarget) onActivate?.(e); } }, children)),
  // DialogInputLabelGroup and DialogRequirementLabel must remain visible.
  TextField: ({ label, value, onChange, onKeyDown, disabled, type = "text", onFocus, onClick, ...props }) => {
    const control = h("div", { className: "DialogInput_Wrapper _DialogLayout" }, h("input", { "aria-label": props["aria-label"], className: "DialogInput DialogTextInputBase", "data-native-steam-field": true, type, value, onChange, onFocus, onClick, onKeyDown, disabled }));
    return label ? h("div", { className: "DialogInputLabelGroup _DialogLayout DialogRequirementLabel" }, h("label", {}, h("div", { className: "DialogLabel" }, label), control)) : control;
  },
  Router: steamRouter,
  Dropdown: ({ rgOptions, selectedOption, onChange }) => h("select", { "aria-label": "Modell", value: selectedOption, onChange: e => onChange({ data: e.target.value }) }, rgOptions.map(o => h("option", { key: o.data, value: o.data }, o.label))),
  ConfirmModal: () => h("div"), showModal() {},
  Navigation: { Navigate: path => { backstack.push(path); render(path); }, CloseSideMenus() {}, NavigateBack() { if (backstack.length > 1) { backstack.pop(); render(backstack.at(-1)); } else window.__test.closed = true; }, NavigateToExternalWeb() {} }
};
window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit = { connect: () => api };
import(window.location.origin + "/dist/index.js").then(module => { module.default(); root = createRoot(document.getElementById("root")); render("/decky-codex"); });
