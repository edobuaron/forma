import { format } from "date-fns";
import { Award, ChevronLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExerciseFormButton } from "@/components/exercises/exercise-form";
import { ExerciseProgressChart } from "@/components/exercises/progress-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Stat } from "@/components/ui/misc";
import { formatPerformance } from "@/components/workout/format";
import { bestLoadForReps, bestRepsByLoad, MUSCLE_LABELS, sessionPoints } from "@/lib/domain/analytics";
import { compareStreams } from "@/lib/domain/comparison";
import { recordLabel, StreamComparisonList } from "@/components/workout/stream-comparison";
import { exerciseInsights } from "@/lib/domain/insights";
import { headline, recommendFor } from "@/lib/domain/progression";
import { prLabel, type PRType } from "@/lib/domain/prs";
import { workingSets } from "@/lib/domain/sets";
import { formatWeight } from "@/lib/domain/units";
import { completedSetHistory, exerciseRecords, getActiveProgram, getExercise, getProfile, groupHistory } from "@/lib/data/queries";
import { toExerciseConfig, toPrescription, defaultContext } from "@/lib/data/types";
import { WEIGHT_ENTRY_SHORT } from "@/lib/catalog/conventions";
import { attachmentLabel, compatibleHistory, performedSets } from "@/lib/domain/sides";
import { requireUser } from "@/lib/supabase/server";

const ENTRY_HINT: Record<string, string> = {
  total: "Weight is logged as the total, bar included.",
  per_dumbbell: "Weight is logged per dumbbell.",
  per_side: "Weight is logged per side.",
  stack: "Weight is the number on the stack.",
  added: "Weight is the load added to your bodyweight; 0 means bodyweight only.",
  assistance: "Weight is the assistance; less assistance means harder.",
};

export default async function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const ex = await getExercise(supabase, id);
  if (!ex) notFound();
  const [profile, rows, records, program] = await Promise.all([
    getProfile(supabase), completedSetHistory(supabase, { exerciseIds: [id] }), exerciseRecords(supabase, id), getActiveProgram(supabase),
  ]);
  const unit = profile.unit;
  const cfg = toExerciseConfig(ex);
  const history = groupHistory(rows).get(id) ?? []; // newest first
  const points = sessionPoints(cfg, history);
  const allSets = history.flatMap((h) => h.sets);
  const ws = performedSets(allSets, cfg);
  const usedIn = (program?.templates ?? []).flatMap((t) => t.exercises.filter((e) => e.exercise_id === id).map((e) => ({ t, e })));
  const rx = usedIn[0] ? toPrescription({ sets: usedIn[0].e.sets, rep_min: usedIn[0].e.rep_min, rep_max: usedIn[0].e.rep_max, rest_s: usedIn[0].e.rest_s }) : toPrescription(null, ex);
  const rec = recommendFor(cfg, rx, history, defaultContext(ex), { conservative: profile.progression_conservative });
  const insights = exerciseInsights(cfg, history);
  const [last, prev] = history;
  const heaviest = ws.length ? ws.reduce((a, s) => ((s.weightKg ?? 0) > (a.weightKg ?? 0) ? s : a)) : null;
  const bestE1rm = points.reduce<number | null>((a, p) => (p.bestE1rmKg != null && (a == null || p.bestE1rmKg > a) ? p.bestE1rmKg : a), null);
  const repTable = bestRepsByLoad(cfg, allSets).slice(0, 8);
  const loadFor = [5, 8, 10, 12, 15].map((r) => ({ r, l: bestLoadForReps(cfg, allSets, r) })).filter((x) => x.l != null);
  const showLoad = ex.load_type === "external" || ex.load_type === "weighted_bodyweight";

  return (
    <div>
      <Link href="/exercises" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Exercises</Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">{ex.name}</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {ex.primary_muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(", ")}
            {ex.secondary_muscles.length > 0 && <span className="text-muted-foreground/70"> · {ex.secondary_muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(", ")}</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone="outline">{ex.equipment}</Badge>
            <Badge tone="outline">{ex.category.replace("_", " ")}</Badge>
            <Badge tone="outline">{WEIGHT_ENTRY_SHORT[ex.weight_convention] ?? ex.weight_convention}</Badge>
            <Badge tone="outline">+{formatWeight(Number(ex.increment_kg), unit)} steps{ex.increment_is_generic ? " (generic)" : ""}</Badge>
            {ex.archived_at && <Badge tone="negative">Archived</Badge>}
          </div>
        </div>
        <ExerciseFormButton exercise={ex} variant="outline" size="sm"><Pencil /> Edit</ExerciseFormButton>
      </div>

      <p className="-mt-3 mb-6 text-[13px] text-muted-foreground">
        {ENTRY_HINT[ex.weight_convention]}
        {ex.increment_is_generic && " The load step is a generic default; edit the exercise to set your equipment's real smallest jump."}
      </p>

      {history.length === 0 ? (
        <EmptyState title="No sessions logged yet">Progress, records and recommendations appear once you log this exercise.</EmptyState>
      ) : (
        <div className="space-y-4">
          <Card className="p-5">
            <p className="text-[13px] font-medium text-muted-foreground">Recommendation{usedIn[0] ? ` · ${rx.sets} × ${rx.repMin}–${rx.repMax} in ${usedIn[0].t.name}` : ""}</p>
            <p className="mt-1 text-[17px] font-semibold tracking-tight text-accent">{headline(rec, cfg, unit)}</p>
            <ul className="mt-2 space-y-0.5 text-[13px] text-muted-foreground">{rec.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            {insights.map((i) => <p key={i.key} className="mt-3 border-t pt-3 text-[13px]"><span className="font-medium">{i.title}.</span> <span className="text-muted-foreground">{i.detail}</span></p>)}
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4"><Stat label="Sessions" value={history.length} sub={`since ${format(new Date(history[history.length - 1].date), "MMM yyyy")}`} /></Card>
            <Card className="p-4"><Stat label="Working sets" value={ws.length} /></Card>
            <Card className="p-4">
              <Stat label={ex.load_type === "assisted" ? "Least assistance" : showLoad ? "Heaviest set" : "Best reps"}
                value={ex.load_type === "assisted" ? formatWeight(Math.min(...ws.map((s) => s.assistanceKg ?? 0)), unit) : showLoad && heaviest ? formatWeight(heaviest.weightKg, unit) : Math.max(...ws.map((s) => s.reps ?? 0))}
                sub={showLoad && heaviest ? `× ${heaviest.reps} reps` : undefined} />
            </Card>
            <Card className="p-4">
              {cfg.e1rmEligible && bestE1rm != null ? <Stat label="Best est. 1RM" value={formatWeight(bestE1rm, unit)} sub="Epley estimate" /> : <Stat label="Last session" value={format(new Date(last.date), "d MMM")} sub={`${workingSets(last.sets, cfg).length} sets`} />}
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Progress</CardTitle></CardHeader>
            <CardContent><ExerciseProgressChart points={points} e1rm={cfg.e1rmEligible} unit={unit} loadType={ex.load_type} /></CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Last session vs previous</CardTitle><span className="text-[12px] text-muted-foreground">{format(new Date(last.date), "d MMM")}</span></CardHeader>
              <CardContent className="space-y-1.5">
                {last.attachment?.state && <p className="text-[12.5px] text-muted-foreground">Attachment: {attachmentLabel(last.attachment)}</p>}
                <StreamComparisonList items={compareStreams(last.sets, compatibleHistory(history.slice(1), last.attachment), cfg)} loadType={cfg.loadType} unit={unit} />
                {!prev && <p className="text-[12.5px] text-muted-foreground">No earlier session to compare.</p>}
              </CardContent>
            </Card>

            {showLoad && repTable.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Best reps at each load</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[14px] tabular">
                    {repTable.map((r) => (
                      <div key={r.loadKg} className="flex justify-between"><span className="text-muted-foreground">{ex.load_type === "weighted_bodyweight" ? (r.loadKg ? "+" + formatWeight(r.loadKg, unit) : "BW") : formatWeight(r.loadKg, unit)}</span><span className="font-medium">{r.reps}</span></div>
                    ))}
                  </div>
                  {loadFor.length > 0 && (
                    <div className="mt-4 border-t pt-3">
                      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Heaviest load for at least…</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] tabular">
                        {loadFor.map((x) => <span key={x.r}><span className="text-muted-foreground">{x.r} reps</span> <span className="font-medium">{formatWeight(x.l!, unit)}</span></span>)}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {records.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-1.5"><Award className="size-4" /> Personal records</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {records.slice(0, 10).map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2 text-[14px]">
                      <span>{recordLabel(prLabel(r.type as PRType), r.side)} <span className="text-muted-foreground">· {format(new Date(r.achieved_at), "d MMM yyyy")}</span></span>
                      <span className="font-medium tabular">{r.type === "best_e1rm" ? `${formatWeight(Number(r.value), unit)} est.` : r.type === "most_reps" ? `${r.reps} reps` : r.type === "least_assistance" ? `${formatWeight(Number(r.value), unit)} assist` : `${formatWeight(Number(r.load_kg), unit)} × ${r.reps}`}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              <ul className="divide-y">
                {history.slice(0, 30).map((h) => (
                  <li key={h.sessionId}>
                    <Link href={`/history/${h.sessionId}`} className="flex items-baseline justify-between gap-4 py-2.5 hover:opacity-80">
                      <span className="w-24 shrink-0 text-[13px] text-muted-foreground">{format(new Date(h.date), "d MMM yyyy")}</span>
                      <span className="flex-1 text-right text-[14px] tabular">{formatPerformance(h.sets, cfg.loadType, unit, workingSets(h.sets, cfg))}{h.attachment?.state ? <span className="text-muted-foreground"> · {attachmentLabel(h.attachment)}</span> : null}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
