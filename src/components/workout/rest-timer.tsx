"use client";
import { ChevronDown, Minus, Plus, SkipForward, Timer, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { DONE_GRACE_MS, progress, remainingS, restSourceLabel, type RestSource, type RestState } from "@/lib/domain/rest";
import { cn, formatDuration } from "@/lib/utils";

export type { RestState } from "@/lib/domain/rest";

// ---------- alerts (only while the page is open: browsers can't reliably alert from the background) ----------

let audioCtx: AudioContext | null = null;

/** iOS only plays sound from an AudioContext created or resumed in a tap; call this from one. */
export function unlockRestSound() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch { /* audio unavailable */ }
}

export const soundSupported = () => typeof window !== "undefined" && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
export const vibrationSupported = () => typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

function beep() {
  try {
    unlockRestSound();
    const ctx = audioCtx;
    if (!ctx) return;
    for (const [i, f] of [880, 1175].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.22;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.32);
    }
  } catch { /* audio unavailable */ }
}

export interface RestAlerts { sound: boolean; vibrate: boolean }

/** Re-renders while a timer runs, and right away when the app comes back to the foreground. */
export function useNow(active: boolean, every = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), every);
    const wake = () => setNow(Date.now());
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [active, every]);
  return now;
}

/** True while an on-screen keyboard is probably open (a text field is focused on a touch device, or the viewport shrank). */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && ((el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes((el as HTMLInputElement).type)) || el.tagName === "TEXTAREA" || el.isContentEditable);
      const vv = window.visualViewport;
      const shrunk = vv ? window.innerHeight - vv.height > 120 : false;
      setOpen(typing && (coarse || shrunk));
    };
    const later = () => setTimeout(check, 50);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    window.visualViewport?.addEventListener("resize", check);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
      window.visualViewport?.removeEventListener("resize", check);
    };
  }, []);
  return open;
}

export interface NextUp {
  title: string;
  detail: string | null;
}

export interface RestLengthInfo {
  itemId: string;
  name: string;
  /** Rest from the workout's prescription or the exercise, before any override. */
  plannedS: number;
  plannedSource: RestSource;
  overrideS: number | null;
}

const PRESETS = [60, 90, 120, 150, 180, 240];

/**
 * Compact rest control pinned to the bottom of the active workout: time left, −15 s, +15 s and Skip,
 * with an expandable panel for what's next, this workout's rest length and alerts. While the
 * keyboard is open it gives way to the chip in the header (RestChip).
 */
export function RestTimer({
  rest, hidden, onAdjust, onSkip, onExpire, next, length, onLength, alerts, onAlerts, betweenSides,
}: {
  rest: RestState | null;
  hidden: boolean;
  onAdjust: (deltaS: number) => void;
  onSkip: () => void;
  /** Called once a finished rest has been shown long enough. */
  onExpire: () => void;
  next: NextUp | null;
  length: RestLengthInfo | null;
  /** Set (seconds) or clear (null) this workout's rest for the exercise. Never changes the program. */
  onLength: (seconds: number | null) => void;
  alerts: RestAlerts;
  onAlerts: (a: RestAlerts) => void;
  betweenSides: { available: boolean; on: boolean; onChange: (on: boolean) => void };
}) {
  const now = useNow(!!rest);
  const [expanded, setExpanded] = useState(false);
  const fired = useRef<number | null>(null);
  const panelId = useId();
  const remaining = rest ? remainingS(rest, now) : 0;
  const done = !!rest && remaining <= 0;

  useEffect(() => {
    if (!rest || !done || fired.current === rest.endAt) return;
    fired.current = rest.endAt;
    // Alert only when the deadline passes while Forma is on screen; never a late alert on return.
    if (document.visibilityState === "visible" && Date.now() - rest.endAt < 3000) {
      if (alerts.sound) beep();
      if (alerts.vibrate && vibrationSupported()) navigator.vibrate([120, 60, 120]);
    }
  }, [done, rest, alerts]);

  useEffect(() => {
    if (!rest || !done) return;
    const t = setTimeout(onExpire, Math.max(0, rest.endAt + DONE_GRACE_MS - Date.now()));
    return () => clearTimeout(t);
  }, [done, rest, onExpire]);

  if (!rest || hidden) return null;
  const pct = progress(rest, now);
  const current = length && rest.itemId === length.itemId ? length : null;

  return (
    <div className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3 md:left-60">
      <section aria-label="Rest timer" className="pointer-events-auto mx-auto max-w-2xl overflow-hidden rounded-xl border bg-card/95 shadow-raised backdrop-blur-xl animate-in">
        <div className="h-1 bg-subtle">
          <div className={cn("h-full transition-[width] duration-300 ease-linear", done ? "bg-done" : "bg-accent")} style={{ width: `${pct * 100}%` }} />
        </div>
        {expanded && (
          <div id={panelId} className="max-h-[55dvh] space-y-3 overflow-y-auto border-b px-4 pb-3 pt-3 text-[13px]">
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Next up</p>
              {next ? (
                <p className="mt-0.5 leading-snug"><span className="font-semibold">{next.title}</span>{next.detail && <span className="text-muted-foreground"> · {next.detail}</span>}</p>
              ) : <p className="mt-0.5 text-muted-foreground">All planned sets are done.</p>}
            </div>
            {current && (
              <div>
                <p className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Rest for {current.name}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {current.overrideS != null
                    ? <>Changed to <span className="font-semibold text-foreground tabular">{formatDuration(current.overrideS * 1000)}</span> for this workout. {restSourceLabel[current.plannedSource]}: <span className="tabular">{formatDuration(current.plannedS * 1000)}</span>.</>
                    : <>{restSourceLabel[current.plannedSource]}: <span className="font-semibold text-foreground tabular">{formatDuration(current.plannedS * 1000)}</span>.</>}
                  {" "}Your program isn&apos;t changed.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Rest length for ${current.name} in this workout`}>
                  <button
                    onClick={() => onLength(null)} aria-pressed={current.overrideS == null}
                    className={cn("h-9 rounded-full border px-3 text-[12.5px] font-semibold", current.overrideS == null ? "border-accent bg-accent-soft text-accent" : "text-muted-foreground hover:bg-muted")}
                  >
                    Planned <span className="tabular">{formatDuration(current.plannedS * 1000)}</span>
                  </button>
                  {PRESETS.filter((s) => s !== current.plannedS).map((s) => (
                    <button
                      key={s} onClick={() => onLength(s)} aria-pressed={current.overrideS === s}
                      className={cn("h-9 rounded-full border px-3 text-[12.5px] font-semibold tabular", current.overrideS === s ? "border-accent bg-accent-soft text-accent" : "text-muted-foreground hover:bg-muted")}
                    >
                      {formatDuration(s * 1000)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {soundSupported() && (
                <label className="flex items-center justify-between gap-3">
                  <span>Sound when rest ends</span>
                  <Switch checked={alerts.sound} onCheckedChange={(v) => { unlockRestSound(); onAlerts({ ...alerts, sound: v }); }} />
                </label>
              )}
              {vibrationSupported() && (
                <label className="flex items-center justify-between gap-3">
                  <span>Vibrate when rest ends</span>
                  <Switch checked={alerts.vibrate} onCheckedChange={(v) => onAlerts({ ...alerts, vibrate: v })} />
                </label>
              )}
              {betweenSides.available && (
                <label className="flex items-center justify-between gap-3">
                  <span>Rest between left and right sides</span>
                  <Switch checked={betweenSides.on} onCheckedChange={betweenSides.onChange} />
                </label>
              )}
              <p className="text-[12px] leading-snug text-muted-foreground">
                Alerts play only while Forma is open on screen. If your phone locks or you switch apps, the time left is still correct when you come back.
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 px-3 py-2 sm:gap-2 sm:px-4">
          <button
            aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
            aria-label={expanded ? "Hide rest details" : "Show rest details and what's next"}
            onClick={() => setExpanded((e) => !e)}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium text-muted-foreground">
                {done ? "Rest complete" : rest.betweenSides ? "Rest between sides" : "Rest"} · {rest.label}
              </span>
              <span role="timer" aria-live="off" className={cn("num block text-[26px] leading-tight", done && "text-done")}>
                {done ? "Go" : formatDuration(remaining * 1000)}
              </span>
              {!expanded && next && (
                <span className="block truncate text-[11.5px] text-muted-foreground">Next: {next.title}{next.detail ? ` · ${next.detail}` : ""}</span>
              )}
            </span>
            <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !expanded && "rotate-180")} />
          </button>
          {!done && (
            <>
              <button aria-label="Subtract 15 seconds" onClick={() => onAdjust(-15)} className="grid h-11 min-w-11 place-items-center rounded-full bg-subtle px-2 text-[12px] font-semibold tabular active:scale-95">
                <span className="flex items-center"><Minus className="size-3.5" />15</span>
              </button>
              <button aria-label="Add 15 seconds" onClick={() => onAdjust(15)} className="grid h-11 min-w-11 place-items-center rounded-full bg-subtle px-2 text-[12px] font-semibold tabular active:scale-95">
                <span className="flex items-center"><Plus className="size-3.5" />15</span>
              </button>
            </>
          )}
          <button aria-label={done ? "Dismiss rest timer" : "Skip rest"} onClick={onSkip} className="flex h-11 items-center gap-1 rounded-full bg-subtle px-3 text-[12.5px] font-semibold active:scale-95">
            {done ? <X className="size-4" /> : <><SkipForward className="size-3.5" /> Skip</>}
          </button>
        </div>
      </section>
    </div>
  );
}

/** The timer in the header while the keyboard is open, so it never covers the field being typed in. */
export function RestChip({ rest, onSkip }: { rest: RestState; onSkip: () => void }) {
  const now = useNow(true, 500);
  const remaining = remainingS(rest, now);
  return (
    <span className="flex h-9 items-center gap-0.5 rounded-full bg-accent-soft pl-2.5 text-[13px] font-semibold text-accent tabular">
      <Timer aria-hidden className="size-3.5" />
      <span role="timer" aria-label="Rest left" className="ml-1">{remaining > 0 ? formatDuration(remaining * 1000) : "Go"}</span>
      <button aria-label={remaining > 0 ? "Skip rest" : "Dismiss rest timer"} onMouseDown={(e) => e.preventDefault()} onClick={onSkip} className="grid size-9 place-items-center rounded-full">
        <X className="size-3.5" />
      </button>
    </span>
  );
}
