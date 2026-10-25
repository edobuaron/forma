import { notFound, redirect } from "next/navigation";
import { ActiveWorkout } from "@/components/workout/active-workout";
import { getProfile, getSessionFull, listDismissed, listExercises, recentHistory } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Workout" };

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const session = await getSessionFull(supabase, id);
  if (!session) notFound();
  if (session.status !== "in_progress") redirect(`/history/${id}`);

  const exerciseIds = [...new Set(session.exercises.map((e) => e.exercise_id))];
  const [profile, history, library, dismissed, template] = await Promise.all([
    getProfile(supabase),
    recentHistory(supabase, exerciseIds, 6, id),
    listExercises(supabase),
    listDismissed(supabase),
    session.template_id
      ? supabase.from("workout_templates").select("warmup_notes").eq("id", session.template_id).maybeSingle().then((r) => r.data)
      : Promise.resolve(null),
  ]);

  return (
    <ActiveWorkout
      initialSession={session}
      initialHistory={Object.fromEntries(history.byExercise)}
      library={library}
      profile={profile}
      warmupNotes={(template as { warmup_notes: string | null } | null)?.warmup_notes ?? null}
      dismissed={dismissed.map((d) => `${d.rule_key}:${d.evidence_session_id ?? ""}`)}
    />
  );
}
