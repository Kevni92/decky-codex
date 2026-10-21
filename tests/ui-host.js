// A simulated Steam/Decky host for testing the real compiled plugin.
import React from "react";
import { createRoot } from "react-dom/client";
import * as jsx from "react/jsx-runtime";
const h = React.createElement;
let route;
let event;
const calls = [];
const state = {
  generation: "ui-test", version: "0.1.0", busy: false, error: "", login: null,
  account: { type: "chatgpt", email: "test@example.invalid" }, models: [],
  chats: [{ id: "chat", title: "Speicher prüfen", updated: 0 }],
  chat: { id: "chat", title: "Speicher prüfen", messages: [
    { id: "u", role: "user", text: "Welche Dateien brauchen viel Platz?" },
    { id: "a", role: "assistant", text: "## Speicherübersicht\n\nSteam-Spiele bleiben ausgeschlossen.\n\n| Name | Größe |\n| --- | ---: |\n| Archiv.zip | 2,4 GiB |\n| Aufnahme.mp4 | 1,8 GiB |\n\n<img src=x onerror=alert(1)>" }
  ] },
  activities: [{ id: "step", title: "Speicheranalyse abgeschlossen", details: "Exakter Werkzeugschritt: 42 Dateien geprüft", status: "completed" }],
  sessions: [], requests: [],
  inventory: { id: "scan", warnings: [], errors: 0, metric: "Belegter Platz", visited: 42,
    rows: [{ id: "file", name: "Archiv.zip", path: "/home/deck/Downloads/Archiv.zip", bytes: 2400000000, logicalBytes: 2400000000, category: "Download" }] }
};
window.__test = { calls, state, request(kind) { state.requests = [{ id: "req", generation: "ui-test", kind, title: kind === "password" ? "Linux-Benutzerpasswort" : "X oder Y?", details: "Erklärung der Auswirkungen", options: kind === "question" ? [{ id: "x", value: "X", label: "Lokale Installation", description: "Nur für diesen Benutzer" }, { id: "y", value: "Y", label: "Systemweite Installation", description: "Benötigt Administratorrechte" }] : [] }]; event?.({ ...state }); } };
const api = {
  _version: 2,
  callable: () => async (method, params) => {
    calls.push({ method, params: method === "resolve" ? { ...params, password: params.password ? "[redacted]" : undefined } : params });
    if (method === "resolve") state.requests = [];
    if (method === "cleanup") state.requests = [{ id: "cleanup", generation: "ui-test", kind: "approval", title: "Auswahl in den Papierkorb verschieben?", details: "/home/deck/Downloads/Archiv.zip", options: [] }];
    return { ok: true, state: { ...state } };
  },
  addEventListener: (_, handler) => { event = handler; return handler; },
  removeEventListener() {},
  routerHook: { addRoute: (_, component) => { route = component; }, removeRoute() {} }
};
const Button = ({ children, onClick, disabled, style }) => h("button", { onClick, disabled, style }, children);
window.SP_REACT = React;
window.SP_JSX = jsx;
window.DFL = {
  DialogButton: Button, ButtonItem: Button,
  PanelSection: ({ children }) => h("section", {}, children), PanelSectionRow: ({ children }) => h("div", {}, children),
  Focusable: React.forwardRef(({ children, ...props }, ref) => h("div", { ...props, ref, tabIndex: 0 }, children)),
  TextField: ({ label, value, onChange, onKeyDown, disabled, bIsPassword }) => h("label", {}, label,
    h("input", { "aria-label": label, type: bIsPassword ? "password" : "text", value, onChange, onKeyDown, disabled })),
  Dropdown: () => h("div"), ConfirmModal: () => h("div"), showModal() {},
  Navigation: { Navigate() {}, CloseSideMenus() {}, NavigateBack() {}, NavigateToExternalWeb() {} }
};
window.__DECKY_SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED_deckyLoaderAPIInit = { connect: () => api };
import(window.location.origin + "/dist/index.js").then(module => { module.default(); createRoot(document.getElementById("root")).render(h(route)); });
