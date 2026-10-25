"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Gym-friendly numeric input: big target, select-all on focus, decimal keypad,
 * validates before committing. Invalid text stays visible (red) but is never saved.
 */
export function NumberField({
  value, onCommit, placeholder, min = 0, max, step = "any", integer = false, suggested = false, className, ariaLabel,
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
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

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
    <input
      aria-label={ariaLabel}
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
        invalid && "border-negative/60 text-negative",
        className,
      )}
    />
  );
}
