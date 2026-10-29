"use client";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { useState } from "react";
import { DaySheet, dayFromKey } from "@/components/workout/day-sheet";
import type { DayWorkout, StartTemplate } from "@/lib/data/queries";
import { cn } from "@/lib/utils";

export interface StripDay {
  key: string; // yyyy-MM-dd
  isToday: boolean;
  isFuture: boolean;
  workouts: DayWorkout[];
}

/** This week, Monday to Sunday. Any day up to today opens the day sheet. */
export function WeekStrip({ days, templates }: { days: StripDay[]; templates: StartTemplate[] }) {
  const [open, setOpen] = useState<StripDay | null>(null);
  return (
    <>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const dt = dayFromKey(d.key);
          const done = d.workouts.length > 0;
          return (
            <button
              key={d.key}
              type="button"
              disabled={d.isFuture}
              onClick={() => setOpen(d)}
              aria-label={`${format(dt, "EEEE d MMMM")}${done ? `, ${d.workouts.map((w) => w.name).join(", ")}` : ""}`}
              className={cn(
                "flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-md px-1 py-2 transition-colors enabled:hover:bg-muted enabled:active:bg-subtle",
                d.isToday && "bg-muted",
              )}
            >
              <span className={cn("text-[11px] font-semibold text-muted-foreground", d.isToday && "text-accent")}>{d.isToday ? "Today" : format(dt, "EEE")}</span>
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-full text-[13px] font-semibold tabular",
                  done && "bg-positive text-background",
                  !done && d.isToday && "border-2 border-accent text-foreground",
                  !done && !d.isToday && (d.isFuture ? "text-muted-foreground/45" : "text-muted-foreground"),
                )}
              >
                {done ? <Check className="size-4 animate-pop" strokeWidth={3} aria-hidden /> : dt.getDate()}
              </span>
              <span className="hidden w-full truncate text-center text-[11px] text-muted-foreground sm:block">
                {done ? d.workouts.map((w) => w.name).join(" + ") : d.isToday ? "Today" : " "}
              </span>
            </button>
          );
        })}
      </div>
      <DaySheet
        day={open ? dayFromKey(open.key) : null}
        workouts={open?.workouts ?? []}
        templates={templates}
        onOpenChange={(o) => !o && setOpen(null)}
      />
    </>
  );
}
