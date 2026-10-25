import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { MonthCalendar } from "@/components/history/month-calendar";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { getActiveProgram, listSessions, toDayWorkout, toStartTemplates } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";
import { formatMinutes } from "@/lib/utils";

export const metadata = { title: "History" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const today = new Date();
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? new Date(`${sp.m}-01T00:00:00`) : startOfMonth(today);
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const [sessions, program, all] = await Promise.all([
    listSessions(supabase, { from: gridStart.toISOString(), to: new Date(gridEnd.getTime() + 86400000).toISOString() }),
    getActiveProgram(supabase),
    listSessions(supabase, { limit: 60 }),
  ]);
  const monthSessions = sessions.filter((s) => isSameMonth(new Date(s.started_at), month));
  const todayKey = format(today, "yyyy-MM-dd");
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd }).map((d) => {
    const key = format(d, "yyyy-MM-dd");
    return {
      key,
      inMonth: isSameMonth(d, month),
      isToday: key === todayKey,
      isFuture: key > todayKey,
      workouts: sessions.filter((s) => format(new Date(s.started_at), "yyyy-MM-dd") === key).reverse().map(toDayWorkout),
    };
  });

  const byMonth = new Map<string, typeof all>();
  for (const s of all) {
    const k = format(new Date(s.started_at), "MMMM yyyy");
    byMonth.set(k, [...(byMonth.get(k) ?? []), s]);
  }

  return (
    <>
      <PageHeader title="History" subtitle={`${monthSessions.length} workout${monthSessions.length === 1 ? "" : "s"} in ${format(month, "MMMM")}`} />

      <Card className="mb-6 p-4 md:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold tracking-tight">{format(month, "MMMM yyyy")}</h2>
          <div className="flex gap-1">
            <Link aria-label="Previous month" href={`/history?m=${format(addMonths(month, -1), "yyyy-MM")}`} className="grid size-9 place-items-center rounded-full hover:bg-muted"><ChevronLeft className="size-4" /></Link>
            <Link aria-label="Next month" href={`/history?m=${format(addMonths(month, 1), "yyyy-MM")}`} className="grid size-9 place-items-center rounded-full hover:bg-muted"><ChevronRight className="size-4" /></Link>
          </div>
        </div>
        <MonthCalendar days={days} templates={toStartTemplates(program?.templates ?? [], all)} />
      </Card>

      {all.length === 0 ? (
        <EmptyState title="No completed workouts yet">Finished workouts appear here. Tap a day above to log one, or open any of them later to correct mistakes.</EmptyState>
      ) : (
        <div className="space-y-6">
          {[...byMonth.entries()].map(([m, list]) => (
            <section key={m}>
              <h3 className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">{m}</h3>
              <div className="divide-y overflow-hidden rounded-lg border bg-card">
                {list.map((s) => (
                  <Link key={s.id} href={`/history/${s.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/60">
                    <div className="w-10 shrink-0 text-center">
                      <p className="text-[11px] font-medium uppercase text-muted-foreground">{format(new Date(s.started_at), "EEE")}</p>
                      <p className="text-[17px] font-semibold tabular leading-tight">{format(new Date(s.started_at), "d")}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">{s.name}</p>
                      <p className="text-[13px] text-muted-foreground tabular">
                        {s.exercise_count} exercises · {s.set_count} sets{s.ended_at && ` · ${formatMinutes(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())}`}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
