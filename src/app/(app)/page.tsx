import { format, formatDistanceToNowStrict } from "date-fns";
import { Award, Check, ChevronRight, Lightbulb, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Bars } from "@/components/charts/charts";
import { DismissButton, StartButton } from "@/components/dashboard/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { headline } from "@/lib/domain/progression";
import { prLabel, type PRType } from "@/lib/domain/prs";
import { formatWeight, kgToDisplay } from "@/lib/domain/units";
import { loadDashboard } from "@/lib/data/dashboard";
import { requireUser } from "@/lib/supabase/server";
import { cn, DAY_NAMES, formatMinutes } from "@/lib/utils";

export const metadata = { title: "Today" };

function greeting(d: Date) {
  const h = d.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard() {
  const { supabase } = await requireUser();
  const d = await loadDashboard(supabase);
  const unit = d.profile.unit;
  const now = new Date();
  const next = d.next;
  const nextIsToday = next?.day_of_week === now.getDay() && !d.week.find((w) => w.isToday)?.done.length;
  // ~40 s per set + prescribed rest + ~8 min for warm-up and changeovers
  const estMinutes = next ? Math.round(next.exercises.reduce((a, e) => a + e.sets * (40 + e.rest_s), 0) / 60 + 8) : 0;
  const fmtW = (v: number) => formatWeight(v, unit);
  const loadLabel = (kg: number, lt: string) => (lt === "bodyweight" || lt === "weighted_bodyweight" ? (kg ? `+${fmtW(kg)}` : "BW") : fmtW(kg));

  return (
    <div className="space-y-5 animate-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{format(now, "EEEE d MMMM")}</p>
          <h1 className="mt-0.5 text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">
            {greeting(now)}{d.profile.display_name ? `, ${d.profile.display_name}` : ""}
          </h1>
        </div>
        <StartButton templateId={null} label="Quick start" variant="outline" className="hidden md:inline-flex" />
      </div>

      {/* Next workout */}
      {next && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:p-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium text-muted-foreground">{nextIsToday ? "Today" : `Next · ${next.day_of_week != null ? DAY_NAMES[next.day_of_week] : "Unscheduled"}`}</p>
                {nextIsToday && <span className="size-1.5 rounded-full bg-accent" />}
              </div>
              <h2 className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">{next.name}</h2>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {next.exercises.length} exercises · {next.exercises.reduce((a, e) => a + e.sets, 0)} sets · ~{estMinutes} min
              </p>
              <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/90">{next.exercises.map((e) => e.exercise.name).join(" · ")}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <StartButton templateId={next.id} size="xl" className="flex-1 md:flex-none" label={`Start ${next.name}`} />
            </div>
          </div>
          {/* Week strip */}
          <div className="grid grid-cols-7 border-t bg-muted/40">
            {d.week.map((w) => {
              const dt = new Date(w.date);
              const done = w.done.length > 0;
              return (
                <div key={w.date} className={cn("flex flex-col items-center gap-1 border-r px-1 py-3 last:border-r-0", w.isToday && "bg-card")}>
                  <span className={cn("text-[11px] font-medium text-muted-foreground", w.isToday && "text-foreground")}>{format(dt, "EEEEE")}</span>
                  <span
                    className={cn(
                      "grid size-7 place-items-center rounded-full text-[12px] font-semibold tabular",
                      done && "bg-accent text-accent-foreground",
                      !done && w.template && !w.missed && "border border-accent/50 text-accent",
                      w.missed && "border border-dashed text-muted-foreground",
                      !done && !w.template && "text-muted-foreground/60",
                    )}
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : dt.getDate()}
                  </span>
                  <span className="hidden w-full truncate text-center text-[11px] text-muted-foreground sm:block">
                    {done ? w.done[0].name : w.template?.name ?? "Rest"}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <StartButton templateId={null} label="Quick start empty workout" variant="outline" size="lg" className="w-full md:hidden" />

      {/* Stats row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>This week</CardTitle></CardHeader>
          <CardContent>
            <p className="text-[32px] font-semibold tabular tracking-tight">
              {d.weekCompleted}<span className="text-[18px] text-muted-foreground"> of {d.weekScheduled || "–"}</span>
            </p>
            <p className="text-[13px] text-muted-foreground">planned workouts completed{d.weekCompleted > d.weekScheduled && d.weekScheduled > 0 ? ` (+${d.weekCompleted - d.weekScheduled} extra)` : ""}</p>
            <div className="mt-4 flex gap-1.5">
              {Array.from({ length: d.weekScheduled || d.weekCompleted }, (_, i) => (
                <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < d.weekCompleted ? "bg-accent" : "bg-subtle")} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Weekly volume</CardTitle>
            <span className="text-[12px] text-muted-foreground tabular">
              {d.weekly[d.weekly.length - 1].sets} sets this week
            </span>
          </CardHeader>
          <CardContent className="pt-1">
            {d.weekly.some((w) => w.volume > 0) ? (
              <Bars
                height={140}
                highlightLast
                suffix={` ${unit}`}
                data={d.weekly.map((w) => ({ x: format(new Date(w.week), "d MMM"), y: Math.round(kgToDisplay(w.volume, unit)), title: `Week of ${format(new Date(w.week), "d MMM")}`, detail: `${w.sets} working sets` }))}
              />
            ) : (
              <p className="py-10 text-center text-[13px] text-muted-foreground">Volume appears after your first workout.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><TrendingUp className="size-4" /> Next session{next ? ` · ${next.name}` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            {d.recs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Suggestions appear after you&apos;ve logged these exercises once. Nothing is guessed before then.</p>
            ) : (
              <ul className="divide-y">
                {d.recs.map((r) => (
                  <li key={r.exercise.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <Link href={`/exercises/${r.exercise.id}`} className="text-[14px] font-medium hover:underline">{r.exercise.name}</Link>
                      <p className={cn("text-[13px]", r.rec.action === "increase_load" ? "text-accent" : "text-muted-foreground")}>{headline(r.rec, r.cfg, unit)}</p>
                    </div>
                    {r.rec.evidenceSessionId && <DismissButton ruleKey={`progression:${r.exercise.id}`} evidence={r.rec.evidenceSessionId} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Records */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><Award className="size-4" /> Recent records</CardTitle></CardHeader>
          <CardContent>
            {d.records.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Records are detected automatically from your second session of an exercise onward.</p>
            ) : (
              <ul className="divide-y">
                {d.records.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{r.exercise.name}</p>
                      <p className="text-[12px] text-muted-foreground">{prLabel(r.type as PRType)} · {formatDistanceToNowStrict(new Date(r.achieved_at), { addSuffix: true })}</p>
                    </div>
                    <span className="shrink-0 text-[14px] font-semibold tabular">
                      {r.type === "best_e1rm" ? `${fmtW(Number(r.value))}*` : r.type === "most_reps" ? `${r.reps} reps` : r.type === "least_assistance" ? `${fmtW(Number(r.value))} assist` : `${r.exercise.load_type === "weighted_bodyweight" ? "+" : ""}${fmtW(Number(r.load_kg))} × ${r.reps}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d.records.some((r) => r.type === "best_e1rm") && <p className="mt-3 text-[11px] text-muted-foreground">* Estimated 1RM (Epley formula)</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Insights */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5"><Lightbulb className="size-4" /> Training insights</CardTitle></CardHeader>
          <CardContent>
            {d.insights.length > 0 ? (
              <ul className="space-y-3">
                {d.insights.map((i) => (
                  <li key={i.key} className="flex items-start gap-3">
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", i.severity === "attention" ? "bg-negative" : "bg-accent")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium leading-snug">{i.title}</p>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{i.detail}</p>
                    </div>
                    <DismissButton ruleKey={`insight:${i.key}`} evidence={i.evidenceSessionId ?? null} />
                  </li>
                ))}
              </ul>
            ) : d.enoughData ? (
              <p className="text-[14px] text-muted-foreground">Performance has remained consistent. No adjustment needed.</p>
            ) : (
              <p className="text-[13px] text-muted-foreground">Insights need a few weeks of history. Nothing is inferred from too little data.</p>
            )}
          </CardContent>
        </Card>

        {/* Highlights */}
        <Card>
          <CardHeader><CardTitle>Strength highlights · 8 weeks</CardTitle></CardHeader>
          <CardContent>
            {d.highlights.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Highlights appear when an exercise has two or more sessions in the last 8 weeks.</p>
            ) : (
              <ul className="divide-y">
                {d.highlights.map((h) => (
                  <li key={h.exercise.id}>
                    <Link href={`/exercises/${h.exercise.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium">{h.exercise.name}</p>
                        <p className="text-[12px] text-muted-foreground tabular">
                          {h.metric === "e1rm" ? `Est. 1RM ${fmtW(h.from)} → ${fmtW(h.to)}` : h.metric === "load" ? `${loadLabel(h.from, h.exercise.load_type)} × ${h.fromReps} → ${loadLabel(h.to, h.exercise.load_type)} × ${h.toReps}` : `${h.from} → ${h.to} reps at the same load`}
                        </p>
                      </div>
                      <Badge tone="positive">
                        {h.metric === "reps" ? `+${h.to - h.from} rep${h.to - h.from === 1 ? "" : "s"}` : `+${kgToDisplay(h.to - h.from, unit)} ${unit}`}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent workouts */}
      <Card>
        <CardHeader>
          <CardTitle>Recent workouts</CardTitle>
          <Link href="/history" className="text-[13px] font-medium text-accent">All history</Link>
        </CardHeader>
        <CardContent>
          {d.recent.length === 0 ? (
            <EmptyState title="No workouts yet">Start {next?.name ?? "a workout"} to begin building your history.</EmptyState>
          ) : (
            <ul className="divide-y">
              {d.recent.map((s) => (
                <li key={s.id}>
                  <Link href={`/history/${s.id}`} className="flex items-center gap-4 py-3 hover:opacity-80">
                    <div className="w-11 shrink-0 text-center">
                      <p className="text-[11px] font-medium uppercase text-muted-foreground">{format(new Date(s.started_at), "EEE")}</p>
                      <p className="text-[18px] font-semibold tabular leading-tight">{format(new Date(s.started_at), "d")}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">{s.name}</p>
                      <p className="text-[13px] text-muted-foreground tabular">
                        {s.exercise_count} exercises · {s.set_count} sets
                        {s.ended_at && ` · ${formatMinutes(new Date(s.ended_at).getTime() - new Date(s.started_at).getTime())}`}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
