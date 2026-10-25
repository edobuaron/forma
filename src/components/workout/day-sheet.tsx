"use client";
import { format, isToday } from "date-fns";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { DayWorkout, StartTemplate } from "@/lib/data/queries";
import { formatMinutes } from "@/lib/utils";
import { StartWorkout } from "./start-workout";

/** "yyyy-MM-dd" in the server's time zone → a local Date at midnight. */
export function dayFromKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Tap a day: see what was logged, then pick any workout to start (today) or log (past day). */
export function DaySheet({
  day, workouts, templates, onOpenChange,
}: { day: Date | null; workouts: DayWorkout[]; templates: StartTemplate[]; onOpenChange: (open: boolean) => void }) {
  const today = day ? isToday(day) : false;
  return (
    <Sheet open={!!day} onOpenChange={onOpenChange}>
      {day && (
        <SheetContent
          title={today ? "Today" : format(day, "EEEE d MMMM")}
          description={workouts.length ? `${workouts.length} workout${workouts.length === 1 ? "" : "s"} logged` : today ? "Pick what you're training" : "Nothing logged on this day"}
        >
          {workouts.length > 0 && (
            <div className="mb-5 divide-y overflow-hidden rounded-lg border">
              {workouts.map((w) => (
                <Link key={w.id} href={`/history/${w.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{w.name}</p>
                    <p className="text-[13px] text-muted-foreground tabular">
                      {w.setCount} sets{w.minutes != null && ` · ${formatMinutes(w.minutes * 60000)}`}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">
            {today ? "Start a workout" : workouts.length ? "Log another workout for this day" : "Log a workout for this day"}
          </p>
          <StartWorkout templates={templates} day={day} compact />
        </SheetContent>
      )}
    </Sheet>
  );
}
