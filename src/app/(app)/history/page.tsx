import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { getActiveProgram, listSessions } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";
import { cn, formatMinutes } from "@/lib/utils";

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
  const scheduled = new Map((program?.templates ?? []).filter((t) => t.day_of_week != null).map((t) => [t.day_of_week!, t.name]));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const monthSessions = sessions.filter((s) => isSameMonth(new Date(s.started_at), month));
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const firstSession = all.length ? new Date(all[all.length - 1].started_at) : null;

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
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="pb-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const ds = sessions.filter((s) => new Date(s.started_at).toDateString() === d.toDateString());
            const tpl = scheduled.get(d.getDay());
            const inMonth = isSameMonth(d, month);
            const past = d < todayStart;
            const missed = !!tpl && past && ds.length === 0 && (!firstSession || d >= firstSession);
            const isToday = d.toDateString() === today.toDateString();
            const content = (
              <div
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center rounded-md text-[13px] tabular transition-colors md:aspect-[1.5]",
                  !inMonth && "opacity-35",
                  ds.length > 0 && "bg-accent-soft font-semibold text-accent hover:bg-accent/15",
                  ds.length === 0 && tpl && !past && "border text-foreground",
                  missed && "border border-dashed text-muted-foreground",
                  ds.length === 0 && !tpl && "text-muted-foreground",
                  isToday && "ring-2 ring-accent/60",
                )}
              >
                <span>{d.getDate()}</span>
                <span className={cn("hidden max-w-full truncate px-1 text-[10.5px] font-normal md:block", ds.length === 0 && "text-muted-foreground")}>{ds[0]?.name ?? (tpl && !past ? tpl : missed ? "Skipped" : "")}</span>
                {ds.length > 0 && <span className="absolute bottom-1.5 size-1 rounded-full bg-accent md:hidden" />}
              </div>
            );
            return ds.length ? <Link key={d.toISOString()} href={`/history/${ds[0].id}`}>{content}</Link> : <div key={d.toISOString()}>{content}</div>;
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-accent-soft ring-1 ring-accent/30" /> Completed</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] border" /> Scheduled</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] border border-dashed border-muted-foreground" /> Skipped</span>
        </div>
      </Card>

      {all.length === 0 ? (
        <EmptyState title="No completed workouts yet">Finished workouts appear here. You can open any of them to correct mistakes.</EmptyState>
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
