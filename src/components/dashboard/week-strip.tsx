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
      <div className="grid grid-cols-7 border-t bg-muted/40">
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
                "flex flex-col items-center gap-1 border-r px-1 py-3 transition-colors last:border-r-0 enabled:hover:bg-card enabled:active:bg-muted",
                d.isToday && "bg-card",
              )}
            >
              <span className={cn("text-[11px] font-medium text-muted-foreground", d.isToday && "text-foreground")}>{format(dt, "EEEEE")}</span>
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full text-[12px] font-semibold tabular",
                  done && "bg-accent text-accent-foreground",
                  !done && d.isToday && "border border-accent/60 text-accent",
                  !done && !d.isToday && (d.isFuture ? "text-muted-foreground/45" : "text-muted-foreground"),
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} /> : dt.getDate()}
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
