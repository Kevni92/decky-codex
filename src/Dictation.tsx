import { useEffect, useRef, useState } from "react";
import { DialogButton, Focusable } from "@decky/ui";

type Result = { token?: string; state: string; seconds?: number; text?: string; error?: string };
export type VoiceRpc = (method: string, params?: Record<string, unknown>) => Promise<{ result?: Result }>;
export function Dictation({ rpc, disabled, onText, onBusy }: { rpc: VoiceRpc; disabled: boolean; onText: (text: string) => void; onBusy: (busy: boolean) => void }) {
  const [state, setState] = useState("idle"), [seconds, setSeconds] = useState(0), [error, setError] = useState("");
  const token = useRef<string | undefined>(undefined);
  const mounted = useRef(true), changing = useRef(false), latest = useRef({ onText, onBusy });
  latest.current = { onText, onBusy };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; latest.current.onBusy(false); if (token.current) void rpc("voice_cancel", { token: token.current }).catch(() => {}); };
  }, [rpc]);
  const reset = async () => {
    const value = token.current; token.current = undefined;
    if (value) await rpc("voice_cancel", { token: value }).catch(() => {});
    if (mounted.current) { setState("idle"); latest.current.onBusy(false); }
  };
  useEffect(() => {
    if (!token.current) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = token.current;
        if (!value) return;
        const { result } = await rpc("voice_status", { token: value });
        if (stopped || !mounted.current || value !== token.current || !result) return;
        setSeconds(result.seconds || 0);
        if (result.state === "recorded") { await rpc("voice_finish", { token: value }); setState("transcribing"); }
        else if (result.state === "done") { latest.current.onText(result.text || ""); await reset(); return; }
        else if (result.state === "failed") { setError(result.error || "Spracherkennung fehlgeschlagen."); await reset(); return; }
      } catch (e) { if (!stopped && mounted.current) { setError(e instanceof Error ? e.message : "Sprachaufnahme unterbrochen."); await reset(); } return; }
      if (!stopped) timer = setTimeout(poll, 500);
    };
    timer = setTimeout(poll, 200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [state, rpc]);
  const start = async () => {
    if (changing.current || disabled || state !== "idle") return;
    changing.current = true; setError(""); setState("starting"); latest.current.onBusy(true);
    try {
      const { result } = await rpc("voice_start");
      if (!result?.token) throw Error("Sprachaufnahme konnte nicht gestartet werden.");
      if (!mounted.current) { await rpc("voice_cancel", { token: result.token }); return; }
      token.current = result.token; setSeconds(0); setState("recording");
    } catch (e) { if (mounted.current) { setError(e instanceof Error ? e.message : "Mikrofon nicht verfügbar."); setState("idle"); latest.current.onBusy(false); } }
    finally { changing.current = false; }
  };
  const finish = async () => {
    if (!token.current || changing.current) return;
    changing.current = true;
    try { await rpc("voice_finish", { token: token.current }); if (mounted.current) setState("transcribing"); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Aufnahme fehlgeschlagen."); await reset(); }
    finally { changing.current = false; }
  };
  return <div className={`dc-dictation ${state !== "idle" ? "dc-recording" : ""}`}>
    <DialogButton className="dc-button dc-icon-button" disabled={disabled || state === "starting" || state === "transcribing"}
      onClick={() => { void (state === "recording" ? finish() : start()); }}>
      {state === "recording" ? <span className="dc-record-dot" /> : <svg className="dc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>}
      <span className="dc-sr-only">{state === "recording" ? "Aufnahme beenden" : "Spracheingabe starten"}</span>
    </DialogButton>
    {state !== "idle" && <Focusable className="dc-voice-status" flow-children="row" role="status"><span>{state === "starting" ? "Mikrofon wird geöffnet …" : state === "transcribing" ? "Sprache wird lokal erkannt …" : `Aufnahme ${seconds} / 30 s · Zum Beenden Mikrofon wählen`}</span><DialogButton className="dc-button" disabled={state === "starting"} onClick={() => { void reset(); }}>Verwerfen</DialogButton></Focusable>}
    {error && <div className="dc-voice-error" role="alert">{error}</div>}
  </div>;
}
