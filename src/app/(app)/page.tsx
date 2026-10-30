import { format, formatDistanceToNowStrict } from "date-fns";
import { Award, CalendarDays, Check, ChevronRight, Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Bars } from "@/components/charts/charts";
import { DismissButton, NextWorkout, StartButton, TemplateGrid } from "@/components/dashboard/client";
import { chooseNext } from "@/lib/next-workout";
import { WeekStrip } from "@/components/dashboard/week-strip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryBar } from "@/components/ui/category";
import { EmptyState } from "@/components/ui/misc";
import { workoutCategory } from "@/lib/category";
import { headline } from "@/lib/domain/progression";
import { prLabel, type PRType } from "@/lib/domain/prs";
import { recordLabel } from "@/components/workout/stream-comparison";
import { formatWeight, kgToDisplay } from "@/lib/domain/units";
import { loadDashboard } from "@/lib/data/dashboard";
import { requireUser } from "@/lib/supabase/server";
import { cn, formatMinutes } from "@/lib/utils";

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
  const doneToday = d.week.find((w) => w.isToday)?.workouts ?? [];
  const fmtW = (v: number) => formatWeight(v, unit);
  const loadLabel = (kg: number, lt: string) => (lt === "bodyweight" || lt === "weighted_bodyweight" ? (kg ? `+${fmtW(kg)}` : "BW") : fmtW(kg));

  const choice = chooseNext(d.templates, d.recentTemplateIds);
  const next = choice?.template ?? null;
  const others = d.templates.filter((t) => t.id !== next?.id);
  const weekDiff = d.weekCompleted - d.lastWeekCompleted;
  const thisWeekSets = d.weekly[d.weekly.length - 1].sets;

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-muted-foreground">{format(now, "EEEE d MMMM")}</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.03em] md:text-[34px]">
            {greeting(now)}{d.profile.display_name ? `, ${d.profile.display_name}` : ""}
          </h1>
        </div>
        <StartButton templateId={null} label="Empty workout" variant="outline" className="hidden md:inline-flex" />
      </div>

      {/* The next workout, and every other one a tap away. Any workout on any day. */}
      <section aria-label="Start a workout" className="relative overflow-hidden rounded-xl border bg-card shadow-raised">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-primary/15 blur-3xl dark:bg-primary/20" />
        <div className="relative p-5 md:p-7">
          {doneToday.length > 0 && (
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-positive-soft px-3 py-1 text-[13px] font-semibold text-positive">
              <Check className="size-3.5" strokeWidth={3} aria-hidden /> Trained today: {doneToday.map((w) => w.name).join(" + ")}
            </p>
          )}
          {next ? (
            <NextWorkout template={next} basis={choice!.basis} order={d.templates.map((t) => t.name)} />
          ) : (
            <div className="space-y-3 text-[14px] leading-relaxed text-muted-foreground">
              <h2 className="text-[24px] font-bold tracking-[-0.025em] text-foreground">Set up your first workout</h2>
              <p>{d.program ? <>Your program <span className="font-semibold text-foreground">{d.program.name}</span> has no workouts yet.</> : "You don't have an active program yet."} To start logging:</p>
              <ol className="list-decimal space-y-1 pl-5 marker:font-semibold marker:text-accent">
                <li><Link href="/exercises?view=catalog" className="font-semibold text-accent hover:underline">Add exercises</Link> from the catalog, or create your own.</li>
                <li><Link href={d.program ? `/programs/${d.program.id}` : "/programs"} className="font-semibold text-accent hover:underline">Create a workout</Link> in your program and add those exercises.</li>
                <li>Come back here and tap the workout to start. Enter the weight and reps you actually do; nothing is pre-filled.</li>
              </ol>
              <p>Or start an empty workout and add exercises as you go. Want the 4-day starter program? <Link href="/programs" className="font-semibold text-accent hover:underline">Add it again under Programs</Link>.</p>
              <StartButton templateId={null} label="Start empty workout" size="lg" className="mt-1" />
            </div>
          )}
          {others.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[13px] font-medium text-muted-foreground">Or start any other workout</p>
              <TemplateGrid templates={others} />
            </div>
          )}
        </div>
        <div className="relative border-t bg-muted/30 px-3 py-3 md:px-5">
          <div className="mb-1.5 flex items-baseline justify-between px-1">
            <p className="text-[13px] font-semibold">This week</p>
            <p className="text-[12px] text-muted-foreground">Tap a day to log a past workout</p>
          </div>
          <WeekStrip days={d.week} templates={d.templates} />
        </div>
      </section>

      {next && <StartButton templateId={null} label="Start empty workout" variant="outline" size="lg" className="w-full md:hidden" />}

      {/* Progress at a glance */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col">
          <CardHeader><CardTitle>Workouts this week</CardTitle></CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <p className="flex items-baseline gap-2">
              <span className="num text-[48px] leading-none">{d.weekCompleted}</span>
              {weekDiff !== 0 && d.lastWeekCompleted > 0 && (
                <span className={cn("text-[13px] font-semibold tabular", weekDiff > 0 ? "text-positive" : "text-muted-foreground")}>
                  {weekDiff > 0 ? `+${weekDiff}` : weekDiff} vs last week
                </span>
              )}
            </p>
            <p className="mt-1.5 text-[13px] text-muted-foreground tabular">
              Last week {d.lastWeekCompleted} · {thisWeekSets} working sets so far
            </p>
            <div className="mt-auto flex gap-1.5 pt-5" aria-hidden>
              {d.week.map((w) => (
                <span key={w.key} className={cn("h-2 flex-1 rounded-full", w.workouts.length ? "bg-positive" : w.isFuture ? "bg-subtle/50" : "bg-subtle")} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Weekly volume</CardTitle>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">Load × reps, {unit}</p>
            </div>
            <span className="text-right">
              <span className="num block text-[20px] leading-tight">{Math.round(kgToDisplay(d.weekly[d.weekly.length - 1].volume, unit)).toLocaleString("en-US")}<span className="ml-1 text-[13px] font-medium text-muted-foreground">{unit}</span></span>
              <span className="text-[12px] text-muted-foreground">this week</span>
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
            <CardTitle className="flex items-center gap-2"><TrendingUp className="size-4 !text-accent" /> Progress suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            {d.recs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Suggestions appear after you&apos;ve logged an exercise once. Nothing is guessed before then.</p>
            ) : (
              <ul className="divide-y">
                {d.recs.map((r) => (
                  <li key={r.exercise.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <Link href={`/exercises/${r.exercise.id}`} className="text-[14px] font-medium hover:underline">{r.exercise.name}</Link>
                      <p className={cn("text-[13px] leading-snug", r.rec.action === "increase_load" ? "font-semibold text-accent" : "text-muted-foreground")}>{r.rec.action === "increase_load" && <TrendingUp aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />}{headline(r.rec, r.cfg, unit)}</p>
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
          <CardHeader><CardTitle className="flex items-center gap-2"><Award className="size-4 !text-record" /> Recent records</CardTitle></CardHeader>
          <CardContent>
            {d.records.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Records are detected automatically from your second session of an exercise onward.</p>
            ) : (
              <ul className="divide-y">
                {d.records.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{r.exercise.name}</p>
                      <p className="text-[12px] text-muted-foreground">{recordLabel(prLabel(r.type as PRType), r.side)} · {formatDistanceToNowStrict(new Date(r.achieved_at), { addSuffix: true })}</p>
                    </div>
                    <span className="shrink-0 text-[15px] font-bold tabular tracking-tight text-record">
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
          <CardHeader><CardTitle className="flex items-center gap-2"><Lightbulb className="size-4 !text-negative" /> Training insights</CardTitle></CardHeader>
          <CardContent>
            {d.insights.length > 0 ? (
              <ul className="space-y-3">
                {d.insights.map((i) => (
                  <li key={i.key} className="flex items-start gap-3">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", i.severity === "attention" ? "bg-negative" : "bg-accent")} />
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
          <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 !text-positive" /> Strength highlights<span className="font-medium text-muted-foreground">· 8 weeks</span></CardTitle></CardHeader>
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
          <Link href="/history" className="flex items-center gap-0.5 text-[13px] font-semibold text-accent hover:underline">All history <ChevronRight className="size-3.5" /></Link>
        </CardHeader>
        <CardContent>
          {d.recent.length === 0 ? (
            <EmptyState icon={<CalendarDays />} title="No workouts yet">Start the workout above. Each one you finish is listed here.</EmptyState>
          ) : (
            <ul className="divide-y divide-border/70">
              {d.recent.map((s) => (
                <li key={s.id}>
                  <Link href={`/history/${s.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted">
                    <CategoryBar category={workoutCategory(s.name)} className="h-9 self-center" />
                    <div className="w-10 shrink-0 text-center">
                      <p className="text-[11px] font-medium uppercase text-muted-foreground">{format(new Date(s.started_at), "EEE")}</p>
                      <p className="text-[18px] font-semibold tabular leading-tight">{format(new Date(s.started_at), "d")}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold tracking-tight">{s.name}</p>
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
