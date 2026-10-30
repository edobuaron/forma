"use client";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import { cn } from "@/lib/utils";

/** Toggle chips over every muscle an exercise can use. */
export function MuscleChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(MUSCLE_LABELS).map(([k, label]) => {
        const on = value.includes(k);
        return (
          <button type="button" key={k} aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== k) : [...value, k])}
            className={cn("h-8 rounded-full border px-3 text-[13px] transition-colors", on ? "border-accent bg-accent-soft font-medium text-accent" : "text-muted-foreground hover:bg-muted")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
