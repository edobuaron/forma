"use client";
import { Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/utils";

export interface RestState {
  endAt: number; // epoch ms — wall-clock based so it survives backgrounding and reloads
  duration: number; // seconds
  label: string;
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    /* audio unavailable */
  }
}

export function RestTimer({ rest, onChange, sound }: { rest: RestState | null; onChange: (r: RestState | null) => void; sound: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef<number | null>(null);

  useEffect(() => {
    if (!rest) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [rest]);

  const remaining = rest ? Math.ceil((rest.endAt - now) / 1000) : 0;

  useEffect(() => {
    if (rest && remaining <= 0 && fired.current !== rest.endAt) {
      fired.current = rest.endAt;
      if (sound) beep();
      navigator.vibrate?.([120, 60, 120]);
      const t = setTimeout(() => onChange(null), 4000);
      return () => clearTimeout(t);
    }
  }, [remaining, rest, onChange, sound]);

  if (!rest) return null;
  const done = remaining <= 0;
  const pct = Math.max(0, Math.min(1, 1 - (rest.endAt - now) / (rest.duration * 1000)));

  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-40 px-3 pb-3 md:left-60">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border bg-card/95 shadow-xl backdrop-blur-xl animate-in">
        <div className="h-[3px] bg-subtle">
          <div className="h-full bg-accent transition-[width] duration-300 ease-linear" style={{ width: `${pct * 100}%` }} />
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-muted-foreground">{done ? "Rest complete" : "Rest"} · {rest.label}</p>
            <p className={`text-[26px] font-semibold leading-tight tabular tracking-tight ${done ? "text-accent" : ""}`}>
              {done ? "Go" : formatDuration(remaining * 1000)}
            </p>
          </div>
          <button aria-label="Subtract 15 seconds" onClick={() => onChange({ ...rest, endAt: rest.endAt - 15000, duration: Math.max(15, rest.duration - 15) })} className="grid size-11 place-items-center rounded-full bg-subtle active:scale-95">
            <Minus className="size-4" />
          </button>
          <button aria-label="Add 15 seconds" onClick={() => onChange({ ...rest, endAt: Math.max(Date.now(), rest.endAt) + 15000, duration: rest.duration + 15 })} className="grid size-11 place-items-center rounded-full bg-subtle active:scale-95">
            <Plus className="size-4" />
          </button>
          <button aria-label="Skip rest" onClick={() => onChange(null)} className="grid size-11 place-items-center rounded-full bg-subtle active:scale-95">
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
