"use client";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Gym-friendly numeric input: big target, select-all on focus, decimal keypad,
 * validates before committing. Invalid text stays visible (red) but is never saved;
 * the field is marked aria-invalid and described by an explanation of the valid range.
 */
export function NumberField({
  value, onCommit, placeholder, min = 0, max, step = "any", integer = false, suggested = false, className, ariaLabel, onErrorChange,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  placeholder?: string;
  min?: number;
  max: number;
  step?: string;
  integer?: boolean;
  suggested?: boolean; // value is a suggestion not yet confirmed
  className?: string;
  ariaLabel: string;
  /** Lets a parent show the explanation visibly; the field always exposes it to assistive tech. */
  onErrorChange?: (message: string | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const errorId = useId();
  const error = invalid ? `Enter ${integer ? "a whole number" : "a number"} from ${min} to ${max}.` : null;
  const reportError = useRef(onErrorChange);
  reportError.current = onErrorChange;

  useEffect(() => {
    reportError.current?.(error);
  }, [error]);
  useEffect(() => () => reportError.current?.(null), []);

  useEffect(() => {
    if (!focused.current) {
      setText(value == null ? "" : String(value));
      setInvalid(false);
    }
  }, [value]);

  function parse(t: string): number | null | "invalid" {
    const s = t.replace(",", ".").trim();
    if (s === "") return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < min || n > max) return "invalid";
    if (integer && !Number.isInteger(n)) return "invalid";
    return n;
  }

  return (
    <>
      <input
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={errorId}
        inputMode={integer ? "numeric" : "decimal"}
        pattern={integer ? "[0-9]*" : undefined}
        enterKeyHint="done"
        step={step}
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          focused.current = true;
          requestAnimationFrame(() => e.target.select());
        }}
        onBlur={() => {
          focused.current = false;
          const p = parse(text);
          if (p === "invalid") {
            setText(value == null ? "" : String(value));
            setInvalid(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onChange={(e) => {
          setText(e.target.value);
          const p = parse(e.target.value);
          setInvalid(p === "invalid");
          if (p !== "invalid") onCommit(p);
        }}
        className={cn(
          "h-11 w-full min-w-0 rounded-md border border-transparent bg-subtle text-center text-[16px] font-medium tabular outline-none transition-colors",
          "placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-accent/50 focus:bg-card focus:ring-2 focus:ring-ring",
          suggested && "text-muted-foreground",
          invalid && "border-negative/70 text-negative focus:border-negative focus:ring-negative/35",
          className,
        )}
      />
      <span id={errorId} className="sr-only" aria-live="polite">{error}</span>
    </>
  );
}
