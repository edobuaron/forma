"use client";
import { useEffect, useId, useRef, useState } from "react";
import { formatRunTime, parseDurationInput } from "@/lib/domain/running";
import { cn } from "@/lib/utils";

/**
 * A run time: "25" (minutes), "25:30" or "1:05:00". After typing, the field shows how it was read
 * ("25:00"), so a bare number is never silently taken as something else.
 */
export function DurationField({ value, onCommit, ariaLabel, className }: {
  value: number | null; onCommit: (s: number | null) => void; ariaLabel: string; className?: string;
}) {
  const [text, setText] = useState(value == null ? "" : formatRunTime(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const errorId = useId();

  useEffect(() => {
    if (!focused.current) { setText(value == null ? "" : formatRunTime(value)); setInvalid(false); }
  }, [value]);

  return (
    <>
      <input
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={errorId}
        inputMode="text"
        enterKeyHint="done"
        placeholder="mm:ss"
        value={text}
        onFocus={(e) => { focused.current = true; requestAnimationFrame(() => e.target.select()); }}
        onBlur={() => {
          focused.current = false;
          const p = parseDurationInput(text);
          setText(p === "invalid" ? (value == null ? "" : formatRunTime(value)) : p == null ? "" : formatRunTime(p));
          setInvalid(false);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        onChange={(e) => {
          setText(e.target.value);
          const p = parseDurationInput(e.target.value);
          setInvalid(p === "invalid");
          if (p !== "invalid") onCommit(p);
        }}
        className={cn(
          "h-11 w-full min-w-0 rounded-md border border-transparent bg-subtle text-center text-[17px] font-semibold tabular outline-none transition-colors",
          "placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-accent/50 focus:bg-card focus:ring-2 focus:ring-ring",
          invalid && "border-negative/70 text-negative focus:border-negative focus:ring-negative/35",
          className,
        )}
      />
      <span id={errorId} className="sr-only" aria-live="polite">
        {invalid ? "Enter minutes (25), minutes and seconds (25:30) or hours (1:05:00), up to 24 hours." : "A bare number is minutes."}
      </span>
    </>
  );
}
