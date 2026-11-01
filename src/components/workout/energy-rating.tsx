"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ENERGY_LEVELS, ENERGY_MAX, ENERGY_MIN, energyLabel, energyPosition } from "@/lib/domain/energy";
import { cn } from "@/lib/utils";

/** The scale colour at a rating: red → amber → green. Always shown beside the number, never alone. */
function energyColor(v: number) {
  const t = energyPosition(v);
  return t <= 0.5
    ? `color-mix(in oklch, var(--energy-mid) ${Math.round(t * 200)}%, var(--energy-low))`
    : `color-mix(in oklch, var(--energy-high) ${Math.round((t - 0.5) * 200)}%, var(--energy-mid))`;
}

/**
 * A 1–10 radio scale. There is no default: `null` shows nothing selected. Arrow keys, Home/End and
 * the number keys (0 = 10) move the selection.
 */
export function EnergyScale({ value, onChange, labelledBy, autoFocus }: {
  value: number | null; onChange: (v: number) => void; labelledBy?: string; autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const readoutId = useId();
  const tabStop = value ?? ENERGY_MIN;

  useEffect(() => {
    if (autoFocus) refs.current[tabStop - ENERGY_MIN]?.focus();
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(v: number) {
    onChange(v);
    refs.current[v - ENERGY_MIN]?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    const cur = value ?? ENERGY_MIN - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(ENERGY_MAX, value == null ? ENERGY_MIN : cur + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(ENERGY_MIN, value == null ? ENERGY_MIN : cur - 1);
    else if (e.key === "Home") next = ENERGY_MIN;
    else if (e.key === "End") next = ENERGY_MAX;
    else if (/^[0-9]$/.test(e.key)) next = e.key === "0" ? 10 : Number(e.key);
    if (next == null) return;
    e.preventDefault();
    pick(next);
  }

  return (
    <div>
      <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={readoutId} onKeyDown={onKeyDown} className="flex gap-[3px]">
        {ENERGY_LEVELS.map((v) => {
          const selected = value === v;
          const filled = value != null && v < value;
          const color = energyColor(v);
          return (
            <button
              key={v}
              ref={(el) => { refs.current[v - ENERGY_MIN] = el; }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${v}, ${energyLabel(v)}`}
              tabIndex={v === tabStop ? 0 : -1}
              onClick={() => pick(v)}
              style={{
                backgroundColor: selected ? "var(--card)" : `color-mix(in oklch, ${color} ${filled ? 55 : 20}%, transparent)`,
                borderColor: selected ? color : "transparent",
              }}
              className={cn(
                "relative h-12 min-w-0 flex-1 border-2 text-[14px] font-semibold tabular text-foreground outline-none transition-[background-color,transform,box-shadow] duration-150",
                "first:rounded-l-lg last:rounded-r-lg focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                selected ? "z-[1] scale-y-110 rounded-md text-[16px] font-bold shadow-card" : "rounded-[5px] hover:brightness-110 active:scale-95",
              )}
            >
              {v}
            </button>
          );
        })}
      </div>
      <div aria-hidden className="mt-2 flex justify-between text-[12px] font-medium text-muted-foreground">
        <span>Exhausted</span>
        <span>Full of energy</span>
      </div>
      <p id={readoutId} aria-live="polite" className="mt-4 flex min-h-9 items-baseline justify-center gap-2 text-center">
        {value == null ? (
          <span className="text-[13.5px] text-muted-foreground">Not rated. Pick a number from 1 to 10.</span>
        ) : (
          <>
            <span className="num text-[30px] leading-none">{value}</span>
            <span className="text-[13px] font-medium text-muted-foreground">/10</span>
            <span className="text-[15px] font-semibold tracking-tight">{energyLabel(value)}</span>
          </>
        )}
      </p>
    </div>
  );
}

const ENERGY_HINT = "Consider sleep, stress and how tired you feel.";

/**
 * Asks for starting energy. `start`: before a workout begins, with Skip (starts without a rating).
 * `edit`: changes or clears the rating of an existing workout. Closing the sheet changes nothing.
 */
export function EnergySheet({ open, onOpenChange, mode, initial, busy, onSubmit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "start" | "edit";
  initial: number | null;
  busy?: boolean;
  onSubmit: (v: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  const titleId = useId();
  useEffect(() => { if (open) setValue(initial); }, [open, initial]);

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent
        title={mode === "start" ? "How’s your energy today?" : "Starting energy"}
        description={mode === "start" ? `Optional. ${ENERGY_HINT}` : `How you felt when this workout started. ${ENERGY_HINT}`}
      >
        <span id={titleId} className="sr-only">Energy from 1, exhausted, to 10, full of energy</span>
        <div className="pt-2"><EnergyScale value={value} onChange={setValue} labelledBy={titleId} autoFocus /></div>
        <p className="mt-3 text-[12px] text-muted-foreground">
          Just a note for your history. It doesn’t change your targets or recommendations.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="primary" size="lg" disabled={busy || value == null} onClick={() => onSubmit(value)}>
            {busy && <Loader2 className="animate-spin" />} {mode === "start" ? "Start workout" : "Save"}
          </Button>
          {mode === "start" ? (
            <Button variant="ghost" size="lg" disabled={busy} onClick={() => onSubmit(null)}>Skip</Button>
          ) : initial != null ? (
            <Button variant="ghost" size="lg" disabled={busy} onClick={() => onSubmit(null)}>Remove rating</Button>
          ) : (
            <Button variant="ghost" size="lg" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
