import { format } from "date-fns";
import { ArrowRight, Award, Check, Clock, Dumbbell, Layers } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { comparisonText, formatSetLong } from "@/components/workout/format";
import { compareSet, previousCounterpart } from "@/lib/domain/comparison";
import { headline, recommend } from "@/lib/domain/progression";
import { prLabel, type PRType } from "@/lib/domain/prs";
import { completedWorkingSets } from "@/lib/domain/sets";
import { formatVolume, formatWeight } from "@/lib/domain/units";
import { getProfile, getSessionFull, recentHistory, sessionRecords } from "@/lib/data/queries";
import { toExerciseConfig, toLoggedSet, toPrescription } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";
import { formatMinutes } from "@/lib/utils";

export const metadata = { title: "Summary" };

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const session = await getSessionFull(supabase, id);
  if (!session) notFound();
  const exIds = [...new Set(session.exercises.map((e) => e.exercise_id))];
  const [profile, before, withThis, records] = await Promise.all([
    getProfile(supabase),
    recentHistory(supabase, exIds, 1, id),
    recentHistory(supabase, exIds, 6),
    sessionRecords(supabase, id),
  ]);
  const unit = profile.unit;
  const duration = session.ended_at ? new Date(session.ended_at).getTime() - new Date(session.started_at).getTime() : 0;
  const performed = session.exercises.filter((e) => e.sets.some((s) => s.completed));
  const totalSets = performed.reduce((a, e) => a + e.sets.filter((s) => s.completed && s.kind === "working").length, 0);
  const volume = performed.reduce((a, e) => a + e.sets.filter((s) => s.completed && s.kind === "working").reduce((b, s) => b + Number(s.weight_kg ?? 0) * (s.reps ?? 0), 0), 0);

  const rows = performed.map((e) => {
    const cfg = toExerciseConfig(e.exercise);
    const prev = before.byExercise.get(e.exercise_id)?.[0];
    const cur = e.sets.map(toLoggedSet);
    // Pair by position; a set without a logged load shows no comparison rather than a false one.
    const ws = completedWorkingSets(cur);
    const cmps = ws.map((s, i) => compareSet(s, prev ? previousCounterpart(prev.sets, i, cfg) : null, cfg));
    const improved = cmps.filter((c) => c.status === "improved").length;
    const below = cmps.filter((c) => c.status === "below").length;
    const rec = recommend(cfg, toPrescription(e.prescribed, e.exercise), withThis.byExercise.get(e.exercise_id) ?? [], { conservative: profile.progression_conservative });
    return { e, cfg, ws, cmps, improved, below, hasPrev: !!prev, rec, prs: records.filter((r) => r.exercise_id === e.exercise_id) };
  });
  const improvements = rows.filter((r) => r.improved > 0 && r.below === 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-positive/10 text-positive"><Check className="size-6" strokeWidth={2.5} /></span>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{session.name} complete</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">{format(new Date(session.started_at), "EEEE d MMMM")}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { icon: Clock, label: "Duration", value: formatMinutes(duration) },
          { icon: Layers, label: "Working sets", value: totalSets },
          { icon: Dumbbell, label: "Volume", value: formatVolume(volume, unit) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <s.icon className="mb-2 size-4 text-muted-foreground" />
            <p className="whitespace-nowrap text-[17px] font-semibold tabular tracking-tight sm:text-[20px]">{s.value}</p>
            <p className="text-[12px] text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>

      {records.length > 0 && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[13px] font-medium text-muted-foreground"><Award className="size-4 text-accent" /> Personal records</h2>
          <ul className="space-y-2">
            {records.map((r) => {
              const ex = session.exercises.find((e) => e.exercise_id === r.exercise_id)?.exercise;
              return (
                <li key={r.id} className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span><span className="font-medium">{ex?.name}</span> <span className="text-muted-foreground">· {prLabel(r.type as PRType)}</span></span>
                  <span className="shrink-0 font-medium tabular">
                    {r.type === "best_e1rm" ? `${formatWeight(Number(r.value), unit)} est.` : r.type === "least_assistance" ? formatWeight(Number(r.value), unit) + " assist" : `${formatWeight(Number(r.load_kg ?? 0), unit)} × ${r.reps}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {improvements.length > 0 && (
        <Card className="mb-4 p-5">
          <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Main improvements</h2>
          <p className="text-[14px] leading-relaxed">
            Beat last session on {improvements.map((r) => r.e.exercise.name).join(", ")}.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.e.id} className="p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Link href={`/exercises/${r.e.exercise_id}`} className="text-[15px] font-semibold tracking-tight hover:underline">{r.e.exercise.name}</Link>
              {r.hasPrev ? (
                r.improved > 0 && r.below === 0 ? <Badge tone="positive">Improved</Badge>
                  : r.below > 0 && r.improved === 0 ? <Badge tone="negative">Below last</Badge>
                  : r.improved === 0 && r.below === 0 ? (r.cmps.some((c) => c.loadDeltaKg > 0) ? <Badge tone="accent">New load</Badge> : <Badge>Matched</Badge>)
                  : <Badge>Mixed</Badge>
              ) : <Badge tone="outline">First session</Badge>}
            </div>
            <div className="space-y-1">
              {r.ws.map((s, i) => {
                const t = comparisonText(r.cmps[i], unit, r.cfg.loadType);
                return (
                  <div key={i} className="flex items-center justify-between text-[14px]">
                    <span className="tabular"><span className="mr-3 text-muted-foreground">{i + 1}</span>{formatSetLong(s, r.cfg.loadType, unit)}</span>
                    {t && <span className={`text-[12.5px] ${t.tone === "positive" ? "text-positive" : t.tone === "negative" ? "text-negative" : "text-muted-foreground"}`}>{t.text}</span>}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">Next time:</span> {headline(r.rec, r.cfg, unit).replace(" today.", " next session.")}
            </p>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="primary" size="lg"><Link href="/">Done <ArrowRight /></Link></Button>
        <Button asChild variant="ghost" size="lg"><Link href={`/history/${id}`}>View or edit session</Link></Button>
      </div>
    </div>
  );
}
