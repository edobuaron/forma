"use client";
import { format } from "date-fns";
import { useState } from "react";
import { DaySheet, dayFromKey } from "@/components/workout/day-sheet";
import type { DayWorkout, StartTemplate } from "@/lib/data/queries";
import { cn } from "@/lib/utils";

export interface CalendarDay {
  key: string; // yyyy-MM-dd
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  workouts: DayWorkout[];
}

/** Month grid. Tap a day to see what was logged and to log any workout on it. */
export function MonthCalendar({ days, templates }: { days: CalendarDay[]; templates: StartTemplate[] }) {
  const [open, setOpen] = useState<CalendarDay | null>(null);
  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="pb-2">{d}</div>)}
      </div>
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
                "relative flex aspect-square flex-col items-center justify-center rounded-md text-[13px] tabular transition-colors md:aspect-[1.5]",
                !d.inMonth && "opacity-35",
                done ? "bg-accent-soft font-semibold text-accent hover:bg-accent/15" : "text-muted-foreground enabled:hover:bg-muted",
                d.isFuture && "text-muted-foreground/50",
                d.isToday && "ring-2 ring-accent/60",
              )}
            >
              <span>{dt.getDate()}</span>
              <span className="hidden max-w-full truncate px-1 text-[10.5px] font-normal md:block">{d.workouts.map((w) => w.name).join(" + ")}</span>
              {done && <span className="absolute bottom-1.5 size-1 rounded-full bg-accent md:hidden" />}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] text-muted-foreground">Tap any day to log a workout on it.</p>
      <DaySheet
        day={open ? dayFromKey(open.key) : null}
        workouts={open?.workouts ?? []}
        templates={templates}
        onOpenChange={(o) => !o && setOpen(null)}
      />
    </>
  );
}
