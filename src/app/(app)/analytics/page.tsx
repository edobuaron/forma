import { format } from "date-fns";
import { BarChart3 } from "lucide-react";
import { Suspense } from "react";
import { Bars, HBarList, TrendLine } from "@/components/charts/charts";
import { ExerciseSelect, TimeframeControl } from "@/components/charts/controls";
import { ExerciseProgressChart } from "@/components/exercises/progress-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { MUSCLE_LABELS, sessionPoints, TIMEFRAMES, timeframeStart, weekStart, weeklySetsPerMuscle, type TimeframeKey } from "@/lib/domain/analytics";
import { formatWeight, kgToDisplay } from "@/lib/domain/units";
import { completedSetHistory, getProfile, groupHistory, listExercises, listMeasurements, listSessionDates } from "@/lib/data/queries";
import { isWorkingRow, maintenanceMuscles, rowSetCredit, rowVolumeKg, toExerciseConfig } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Progress" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ tf?: string; ex?: string }> }) {
  const sp = await searchParams;
  const tf = (TIMEFRAMES.find((t) => t.key === sp.tf)?.key ?? "3m") as TimeframeKey;
  const start = timeframeStart(tf);
  const { supabase } = await requireUser();
  const [profile, exercises, rows, sessionsAll, measurements] = await Promise.all([
    getProfile(supabase), listExercises(supabase, { includeArchived: true }), completedSetHistory(supabase, { since: start?.toISOString() ?? null }),
    listSessionDates(supabase), listMeasurements(supabase),
  ]);
  const unit = profile.unit;
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const grouped = groupHistory(rows);
  const working = rows.filter(isWorkingRow);

  if (sessionsAll.length === 0) {
    return (<><PageHeader title="Progress" /><EmptyState icon={<BarChart3 />} title="Nothing to analyse yet">Charts are built only from workouts you log — no placeholder data. Finish your first workout to see them.</EmptyState></>);
  }

  // Exercise frequency (sessions per exercise in timeframe)
  const freq = [...grouped.entries()].map(([id, perf]) => ({ id, name: exById.get(id)?.name ?? "—", n: perf.length })).sort((a, b) => b.n - a.n);
  const selected = sp.ex && exById.has(sp.ex) ? sp.ex : freq[0]?.id ?? exercises[0]?.id;
  const selEx = selected ? exById.get(selected)! : null;
  const selPoints = selEx ? sessionPoints(toExerciseConfig(selEx), grouped.get(selEx.id) ?? []) : [];

  // Weekly series
  const firstSession = new Date(sessionsAll[0].started_at);
  const firstDate = start && start > firstSession ? start : firstSession;
  const weeks: string[] = [];
  for (let t = new Date(weekStart(firstDate)).getTime(); t <= Date.now(); t += 7 * 86400000) weeks.push(weekStart(new Date(t)));
  const vol = new Map<string, number>(), sets = new Map<string, number>();
  for (const r of working) {
    const w = weekStart(new Date(r.started_at));
    vol.set(w, (vol.get(w) ?? 0) + rowVolumeKg(r));
    sets.set(w, (sets.get(w) ?? 0) + rowSetCredit(r));
  }
  const sessionsInTf = sessionsAll.filter((s) => !start || new Date(s.started_at) >= start);
  const perWeek = new Map<string, number>();
  for (const s of sessionsInTf) { const w = weekStart(new Date(s.started_at)); perWeek.set(w, (perWeek.get(w) ?? 0) + 1); }
  const wkLabel = (w: string) => format(new Date(w), "d MMM");

  // Muscle sets — weekly average over complete weeks in range
  const muscleWeeks = weeklySetsPerMuscle(working.map((r) => ({ date: r.started_at, primary: exById.get(r.exercise_id)?.primary_muscles ?? [], secondary: exById.get(r.exercise_id)?.secondary_muscles ?? [], credit: rowSetCredit(r) })));
  const nWeeks = Math.max(1, weeks.length);
  const muscleTotals = new Map<string, number>();
  for (const m of muscleWeeks.values()) for (const [k, v] of m) muscleTotals.set(k, (muscleTotals.get(k) ?? 0) + v);
  const maintenance = maintenanceMuscles(profile);
  const muscleAvg = [...muscleTotals.entries()].map(([k, v]) => ({ label: `${MUSCLE_LABELS[k] ?? k}${maintenance.includes(k) ? " · maintenance" : ""}`, value: Math.round((v / nWeeks) * 10) / 10 })).sort((a, b) => b.value - a.value);

  // Consistency: average over complete weeks since the first workout in range
  const completeWeeks = weeks.slice(0, -1);
  const avgPerWeek = completeWeeks.length ? completeWeeks.reduce((a, w) => a + (perWeek.get(w) ?? 0), 0) / completeWeeks.length : null;

  // Monthly (last 12) & yearly
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) months.push(format(new Date(now.getFullYear(), now.getMonth() - i, 1), "yyyy-MM"));
  const perMonth = new Map<string, number>(), perYear = new Map<string, number>();
  for (const s of sessionsAll) {
    const d = new Date(s.started_at);
    perMonth.set(format(d, "yyyy-MM"), (perMonth.get(format(d, "yyyy-MM")) ?? 0) + 1);
    perYear.set(String(d.getFullYear()), (perYear.get(String(d.getFullYear())) ?? 0) + 1);
  }

  // Bodyweight, weighted-bodyweight, assisted and skill movements: charted by reps, added load or assistance.
  const bodyweightMoves = exercises.filter((e) => (e.load_type !== "external" || e.category === "skill") && grouped.has(e.id));

  const bodyweight = measurements.filter((m) => m.bodyweight_kg != null && (!start || new Date(m.measured_on) >= start)).reverse();

  return (
    <>
      <PageHeader title="Progress" subtitle={`${sessionsInTf.length} workouts in this period`} />
      <div className="mb-5 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"><Suspense><TimeframeControl value={tf} /></Suspense></div>

      <div className="space-y-4">
        {selEx && (
          <Card>
            <CardHeader className="flex-col sm:flex-row sm:items-center">
              <CardTitle className="text-[17px]">Exercise progress</CardTitle>
              <Suspense><ExerciseSelect value={selEx.id} options={[...freq.map((f) => ({ id: f.id, name: f.name })), ...exercises.filter((e) => !grouped.has(e.id) && !e.archived_at).map((e) => ({ id: e.id, name: `${e.name} (no data)` }))]} /></Suspense>
            </CardHeader>
            <CardContent>
              {selPoints.length ? <ExerciseProgressChart key={selEx.id} points={selPoints} e1rm={selEx.e1rm_eligible} unit={unit} loadType={selEx.load_type} timeframe={tf} />
                : <p className="py-12 text-center text-[13px] text-muted-foreground">No sessions of {selEx.name} in this period.</p>}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><div><CardTitle>Weekly volume</CardTitle><p className="mt-0.5 text-[12.5px] text-muted-foreground">Load × reps, external load, {unit}</p></div></CardHeader>
            <CardContent><Bars height={200} suffix={` ${unit}`} data={weeks.map((w) => ({ x: wkLabel(w), y: Math.round(kgToDisplay(vol.get(w) ?? 0, unit)), title: `Week of ${wkLabel(w)}`, detail: `${sets.get(w) ?? 0} working sets` }))} /></CardContent>
          </Card>
          <Card>
            <CardHeader><div><CardTitle>Workouts per week</CardTitle><p className="mt-0.5 text-[12.5px] text-muted-foreground">Completed workouts</p></div>{avgPerWeek != null && <span className="text-right"><span className="num block text-[20px] leading-tight text-positive">{avgPerWeek.toFixed(1)}</span><span className="text-[12px] text-muted-foreground">avg per week</span></span>}</CardHeader>
            <CardContent><Bars height={200} color="var(--positive)" suffix=" workouts" data={weeks.map((w) => ({ x: wkLabel(w), y: perWeek.get(w) ?? 0, title: `Week of ${wkLabel(w)}` }))} /></CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><div><CardTitle>Working sets per muscle</CardTitle><p className="mt-0.5 text-[12.5px] text-muted-foreground">Weekly average, sets</p></div></CardHeader>
            <CardContent>
              <HBarList items={muscleAvg} />
              <p className="mt-3 text-[11.5px] text-muted-foreground">Primary muscles count as 1 set, secondary as 0.5.{maintenance.length > 0 && <> Muscles marked maintenance are set in Settings.</>}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><div><CardTitle>Exercise frequency</CardTitle><p className="mt-0.5 text-[12.5px] text-muted-foreground">Sessions in this period</p></div></CardHeader>
            <CardContent><HBarList color="var(--positive)" items={freq.slice(0, 12).map((f) => ({ label: f.name, value: f.n }))} /></CardContent>
          </Card>
        </div>

        {bodyweightMoves.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Bodyweight & skill progression</CardTitle></CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              {bodyweightMoves.map((e) => {
                const cfg = toExerciseConfig(e);
                const pts = sessionPoints(cfg, grouped.get(e.id) ?? []);
                const added = e.load_type === "weighted_bodyweight";
                const assisted = e.load_type === "assisted";
                return (
                  <div key={e.id}>
                    <p className="mb-0.5 text-[15px] font-semibold tracking-tight">{e.name}</p>
                    <p className="mb-2 text-[12px] text-muted-foreground">{added ? "Heaviest added (external) load per session — not total system load" : assisted ? "Assistance per session (lower is harder)" : "Best reps per session"}</p>
                    <TrendLine height={160} integer={!added && !assisted}
                      suffix={added || assisted ? ` ${unit}` : " reps"}
                      data={pts.map((p) => ({ x: format(new Date(p.date), "d MMM"), y: added ? kgToDisplay(p.topLoadKg, unit) : assisted ? kgToDisplay(-p.topLoadKg, unit) : p.repsAtTop, detail: `${added ? "+" + formatWeight(p.topLoadKg, unit) : ""} × ${p.repsAtTop}` }))} />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><div><CardTitle>Completed workouts</CardTitle><p className="mt-0.5 text-[12.5px] text-muted-foreground">Per month, last 12 months</p></div></CardHeader>
            <CardContent>
              <Bars height={180} highlightLast color="var(--positive)" suffix=" workouts" data={months.map((m) => ({ x: format(new Date(`${m}-01T00:00:00`), "MMM"), y: perMonth.get(m) ?? 0, title: format(new Date(`${m}-01T00:00:00`), "MMMM yyyy") }))} />
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-[13px] tabular">
                {[...perYear.entries()].sort().reverse().map(([y, n]) => <span key={y}><span className="text-muted-foreground">{y}</span> <span className="font-bold">{n}</span></span>)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><div><CardTitle>Bodyweight</CardTitle><p className="mt-0.5 text-[12.5px] text-muted-foreground">{unit}</p></div></CardHeader>
            <CardContent>
              {bodyweight.length >= 2 ? (
                <TrendLine height={180} color="var(--record)" suffix={` ${unit}`} data={bodyweight.map((m) => ({ x: format(new Date(m.measured_on), "d MMM"), y: kgToDisplay(Number(m.bodyweight_kg), unit) }))} />
              ) : (
                <p className="py-12 text-center text-[13px] text-muted-foreground">Log bodyweight in Body to see it here. It also gives context to bodyweight exercises.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
