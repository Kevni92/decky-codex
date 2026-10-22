import { useEffect, useRef, useState, type KeyboardEvent, type ComponentType, type ComponentProps } from "react";
import { DialogButton, Focusable, TextField } from "@decky/ui";
import { SteamKeyboard } from "./steam-keyboard";

// Steam forwards remaining props to InputElement; its published types omit type.
const NativeTextField = TextField as ComponentType<ComponentProps<typeof TextField> & { type: "text" | "password"; placeholder?: string }>;

type Props = {
  label: string; value: string; onChange: (value: string) => void;
  disabled?: boolean; password?: boolean; compact?: boolean; onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
};
export function SteamTextInput(props: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const keyboard = useRef<SteamKeyboard | null>(null);
  const opening = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState("");
  const show = () => {
    if (latest.current.disabled || opening.current) return;
    opening.current = true;
    try {
      const input = wrapper.current?.querySelector("input");
      if (!input || input.getClientRects().length === 0) throw new Error("Das Eingabefeld ist nicht sichtbar.");
      keyboard.current ??= new SteamKeyboard(input, value => latest.current.onChange(value));
      keyboard.current.show(); setError("");
    } catch (exc) { setError(exc instanceof Error ? exc.message : "Tastatur konnte nicht geöffnet werden."); }
    finally { opening.current = false; }
  };
  useEffect(() => () => { keyboard.current?.hide(); keyboard.current = null; }, []);
  useEffect(() => { if (props.disabled) keyboard.current?.hide(); }, [props.disabled]);
  return <div className={`dc-input-control ${props.compact ? "dc-input-compact" : ""}`}>
    <Focusable className="dc-input-row" flow-children="row">
      <Focusable className="dc-input-target" flow-children="column" ref={wrapper} onActivate={show} focusClassName="dc-input-focused">
        <NativeTextField label={props.compact ? <span className="dc-sr-only">{props.label}</span> : props.label}
          placeholder={props.compact ? "Frag Codex etwas …" : undefined} aria-label={props.label} value={props.value} disabled={props.disabled} type={props.password ? "password" : "text"}
          onChange={event => props.onChange(event.target.value)} onFocus={show} onClick={show} onKeyDown={props.onKeyDown} />
      </Focusable>
      <DialogButton className="dc-button dc-icon-button dc-keyboard-button" disabled={props.disabled} onClick={show}>
        <svg className="dc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M5 9h2m2 0h2m2 0h2m2 0h2M5 12h2m2 0h2m2 0h2m2 0h2M7 16h10"/></svg>
        <span className="dc-sr-only">Tastatur öffnen: {props.label}</span>
      </DialogButton>
    </Focusable>
    {error && <p className="dc-input-error" role="alert">{error} Bitte das Tastatursymbol erneut wählen.</p>}
  </div>;
}
