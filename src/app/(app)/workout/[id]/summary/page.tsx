import { format } from "date-fns";
import { ArrowRight, Award, Check, Clock, Dumbbell, Layers } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { recordLabel, StreamComparisonList } from "@/components/workout/stream-comparison";
import { compareStreams } from "@/lib/domain/comparison";
import { headline, recommendFor } from "@/lib/domain/progression";
import { attachmentLabel, compatibleHistory } from "@/lib/domain/sides";
import { normalizeSet } from "@/lib/data/set-rows";
import { prLabel, type PRType } from "@/lib/domain/prs";
import { formatVolume, formatWeight } from "@/lib/domain/units";
import { getProfile, getSessionFull, recentHistory, sessionRecords } from "@/lib/data/queries";
import { isWorkingRow, rowVolumeKg, toAttachmentRef, toExerciseConfig, toLoggedSet, toPrescription } from "@/lib/data/types";
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
    recentHistory(supabase, exIds, 6, id),
    recentHistory(supabase, exIds, 6),
    sessionRecords(supabase, id),
  ]);
  const unit = profile.unit;
  const duration = session.ended_at ? new Date(session.ended_at).getTime() - new Date(session.started_at).getTime() : 0;
  const performed = session.exercises.filter((e) => e.sets.some((s) => s.completed));
  const totalSets = performed.reduce((a, e) => a + e.sets.filter(isWorkingRow).length, 0);
  const volume = performed.reduce((a, e) => a + e.sets.reduce((b, s) => b + rowVolumeKg(s), 0), 0);

  const rows = performed.map((e) => {
    const cfg = toExerciseConfig(e.exercise);
    const attachment = toAttachmentRef(e);
    // Each stream (together, left, right) is compared with the same stream, in a compatible setup only.
    const earlier = compatibleHistory(before.byExercise.get(e.exercise_id) ?? [], attachment);
    const streams = compareStreams(e.sets.map((s) => toLoggedSet(normalizeSet(s))), earlier, cfg);
    const cmps = streams.map((c) => c.comparison);
    const improved = cmps.filter((c) => c.status === "improved").length;
    const below = cmps.filter((c) => c.status === "below").length;
    const rec = recommendFor(cfg, toPrescription(e.prescribed, e.exercise), withThis.byExercise.get(e.exercise_id) ?? [],
      { sides: e.track_sides, attachment }, { conservative: profile.progression_conservative });
    return { e, cfg, streams, cmps, improved, below, hasPrev: cmps.some((c) => c.status !== "no_previous"), rec, attachment, prs: records.filter((r) => r.exercise_id === e.exercise_id) };
  });
  const improvements = rows.filter((r) => r.improved > 0 && r.below === 0);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-done text-background shadow-[0_10px_30px_-10px_var(--done)]"><Check className="size-7 animate-pop" strokeWidth={3} /></span>
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em] md:text-[36px]">{session.name} complete</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">{format(new Date(session.started_at), "EEEE d MMMM")}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { icon: Clock, label: "Duration", value: formatMinutes(duration) },
          { icon: Layers, label: "Working sets", value: totalSets },
          { icon: Dumbbell, label: "Volume", value: formatVolume(volume, unit) },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <s.icon className="mb-2 size-4 text-accent" />
            <p className="num whitespace-nowrap text-[19px] sm:text-[24px]">{s.value}</p>
            <p className="text-[12px] text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>

      {records.length > 0 && (
        <Card className="mb-4 p-5">
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Award className="size-4 text-record" /> Personal records</h2>
          <ul className="space-y-2">
            {records.map((r) => {
              const ex = session.exercises.find((e) => e.exercise_id === r.exercise_id)?.exercise;
              return (
                <li key={r.id} className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span><span className="font-medium">{ex?.name}</span> <span className="text-muted-foreground">· {recordLabel(prLabel(r.type as PRType), r.side)}</span></span>
                  <span className="shrink-0 font-bold tabular text-record">
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
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight">Main improvements</h2>
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
            {r.attachment.state && <p className="mb-1.5 text-[12.5px] text-muted-foreground">Attachment: {attachmentLabel(r.attachment)}</p>}
            <StreamComparisonList items={r.streams} loadType={r.cfg.loadType} unit={unit} />
            <p className="mt-3 border-t pt-3 text-[13px] text-muted-foreground">
              <span className="font-semibold text-accent">Next time:</span> {headline(r.rec, r.cfg, unit).replace(" today.", " next session.")}
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
