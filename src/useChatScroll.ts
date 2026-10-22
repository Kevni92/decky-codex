import { useEffect, type RefObject } from "react";
import { Router } from "@decky/ui";

type Subscription = { unregister?: () => void; Unregister?: () => void };
type Input = { RegisterForControllerAnalogInputMessages?: (fn: (...args: unknown[]) => void) => Subscription };
// Steam's current callback is (controller, action, pressed, x, y). Action 47
// is GAMEPAD_ANALOG_SCROLL, supplied by the right stick in Gaming Mode.
export function useChatScroll(frame: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    const root = frame.current, view = root?.ownerDocument.defaultView;
    if (!enabled || !root || !view) return;
    const router = Router as unknown as { WindowStore?: { GetWindowInstanceFromWindow?: (w: Window) => { VirtualKeyboardManager?: { IsShowingVirtualKeyboard?: boolean } } } };
    const scroll = (delta: number) => {
      if (!root.isConnected || root.ownerDocument.hidden || root.ownerDocument.querySelector('[role="dialog"]')) return;
      if (router.WindowStore?.GetWindowInstanceFromWindow?.(view)?.VirtualKeyboardManager?.IsShowingVirtualKeyboard) return;
      const target = root.querySelector<HTMLElement>(".dc-transcript, .dc-page-scroll");
      if (target && Number.isFinite(delta)) target.scrollTop += Math.max(-160, Math.min(160, delta));
    };
    const input = (view as Window & { SteamClient?: { Input?: Input } }).SteamClient?.Input;
    let subscription: Subscription | undefined;
    if (input?.RegisterForControllerAnalogInputMessages) {
      subscription = input.RegisterForControllerAnalogInputMessages((...args) => {
        if (Array.isArray(args[0])) {
          // Older Steam clients batch the same action into nA/x/y/nC records.
          for (const item of args[0] as { nA: number; y: number }[]) if (item.nA === 47) scroll(-item.y * 48);
        } else if (args[1] === 47 && typeof args[4] === "number") scroll(-args[4] * 48);
      });
    }
    // Standard Gamepad API fallback for hosts without Steam's scroll messages.
    let frameId = 0, previous = 0;
    const tick = (now: number) => {
      const dt = previous ? Math.min(50, now - previous) : 0;
      previous = now;
      for (const pad of view.navigator.getGamepads?.() || []) {
        if (!pad?.connected || pad.mapping !== "standard") continue;
        const axis = pad.axes[3] || 0;
        if (Math.abs(axis) > .2) scroll(Math.sign(axis) * (Math.abs(axis) - .2) / .8 * dt * .7);
        break;
      }
      frameId = view.requestAnimationFrame(tick);
    };
    if (!subscription) frameId = view.requestAnimationFrame(tick);
    return () => { subscription?.unregister?.(); subscription?.Unregister?.(); if (frameId) view.cancelAnimationFrame(frameId); };
  }, [frame, enabled]);
}
