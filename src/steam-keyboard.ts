import { Router } from "@decky/ui";

// Steam's keyboard factory expects a reference, not an HTML element. The factory
// supplies that reference and routes output through onTextEntered when provided.
// Contract: SteamTracking/SteamTracking, ClientExtracted/steamui/sp.js,
// CreateVirtualKeyboardRef / ShowVirtualKeyboard / DispatchKeypress.
type KeyboardRef = {
  SetAsCurrentVirtualKeyboardTarget(): void;
  ShowVirtualKeyboard(): void;
  HideVirtualKeyboard(): void;
  BIsActive(): boolean;
};
type KeyboardProps = {
  BIsElementValidForInput(): boolean;
  onTextEntered(key: string): void;
  onEnterKeyPress(): void;
  strEnterKeyLabel: string;
};
type Manager = { CreateVirtualKeyboardRef(props: KeyboardProps): KeyboardRef };
type SteamWindow = { BrowserWindow?: Window; VirtualKeyboardManager?: Manager; m_VirtualKeyboardManager?: Manager };
type SteamRouter = { WindowStore?: {
  GetWindowInstanceFromWindow?: (view: Window) => SteamWindow | null;
  GamepadUIMainWindowInstance?: SteamWindow;
  SteamUIWindows?: SteamWindow[];
} };

function managerFor(input: HTMLInputElement): Manager {
  const view = input.ownerDocument.defaultView;
  const store = (view as (Window & { SteamUIStore?: SteamRouter }) | null)?.SteamUIStore?.WindowStore || (Router as unknown as SteamRouter)?.WindowStore;
  if (!view || !store) throw new Error("Steam-Fenster für die Tastatur nicht gefunden.");
  const owner = store.GetWindowInstanceFromWindow?.(view);
  const candidates = [owner, store.GamepadUIMainWindowInstance, ...(store.SteamUIWindows || [])];
  for (const candidate of candidates) {
    if (!candidate || (candidate !== owner && candidate.BrowserWindow !== view)) continue;
    const manager = candidate.VirtualKeyboardManager || candidate.m_VirtualKeyboardManager;
    if (typeof manager?.CreateVirtualKeyboardRef === "function") return manager;
  }
  throw new Error("Steams Tastaturverwaltung ist für dieses Fenster nicht verfügbar.");
}

// Keep edits local to this input, including in the post-game state where OS
// focus may not have returned to Steam. No key, text or password is logged.
export function editKeyboardText(value: string, start: number, end: number, key: string) {
  let position = start, right = end;
  if (key === "ArrowLeft") position = right = start !== end ? start : start - (Array.from(value.slice(0, start)).pop()?.length || 0);
  else if (key === "ArrowRight") position = right = start !== end ? end : end + (Array.from(value.slice(end))[0]?.length || 0);
  else if (key === "Home") position = right = 0;
  else if (key === "End") position = right = value.length;
  else {
    let insert = key;
    if (key === "Backspace") { if (start === end) start -= Array.from(value.slice(0, start)).pop()?.length || 0; insert = ""; }
    else if (key === "Delete") { if (start === end) end += Array.from(value.slice(end))[0]?.length || 0; insert = ""; }
    else if (["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "Shift", "Control", "Alt", "Meta", "CapsLock"].includes(key) || /[\x00-\x1f\x7f]/.test(key)) return { value, start, end };
    value = value.slice(0, start) + insert + value.slice(end);
    position = right = start + insert.length;
  }
  return { value, start: position, end: right };
}

export class SteamKeyboard {
  private ref: KeyboardRef;
  private opening = false;
  constructor(private input: HTMLInputElement, private change: (value: string) => void) {
    const manager = managerFor(input);
    this.ref = manager.CreateVirtualKeyboardRef({
      BIsElementValidForInput: () => input.isConnected && !input.disabled && input.ownerDocument.activeElement === input,
      strEnterKeyLabel: "Fertig",
      onEnterKeyPress: () => this.hide(),
      onTextEntered: key => {
        if (!input.isConnected || input.disabled || input.ownerDocument.activeElement !== input) return;
        if (key === "Enter" || key === "Escape") { this.hide(); return; }
        const next = editKeyboardText(input.value, input.selectionStart || 0, input.selectionEnd || 0, key);
        // React state is the source of truth; set DOM synchronously so back-to-
        // back native keyboard callbacks see the preceding edit before render.
        input.value = next.value;
        input.setSelectionRange(next.start, next.end);
        this.change(next.value);
      },
    });
  }
  show() {
    if (this.opening || !this.input.isConnected || this.input.disabled) return;
    this.opening = true;
    try {
      this.input.focus({ preventScroll: true });
      if (this.input.ownerDocument.activeElement !== this.input) throw new Error("Das Eingabefeld konnte nicht fokussiert werden.");
      this.ref.SetAsCurrentVirtualKeyboardTarget();
      if (!this.ref.BIsActive()) this.ref.ShowVirtualKeyboard();
      if (!this.ref.BIsActive()) throw new Error("Steam hat die Bildschirmtastatur nicht geöffnet.");
    } finally { this.opening = false; }
  }
  hide() { if (this.ref.BIsActive()) this.ref.HideVirtualKeyboard(); }
}
