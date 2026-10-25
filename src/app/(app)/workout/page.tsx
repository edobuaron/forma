import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { StartWorkout } from "@/components/workout/start-workout";
import { getActiveProgram, getInProgressSession, listSessions } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Start workout" };

export default async function StartPage() {
  const { supabase } = await requireUser();
  const inProgress = await getInProgressSession(supabase);
  if (inProgress) redirect(`/workout/${inProgress.id}`);
  const [program, recent] = await Promise.all([getActiveProgram(supabase), listSessions(supabase, { limit: 20 })]);
  const lastByTemplate: Record<string, string> = {};
  for (const s of recent) if (s.template_id && !lastByTemplate[s.template_id]) lastByTemplate[s.template_id] = s.started_at;

  return (
    <>
      <PageHeader title="Start workout" subtitle={program ? program.name : "No active program"} />
      <StartWorkout
        templates={(program?.templates ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          dayOfWeek: t.day_of_week,
          exerciseCount: t.exercises.length,
          setCount: t.exercises.reduce((a, e) => a + e.sets, 0),
          exercises: t.exercises.map((e) => e.exercise.name),
          lastDone: lastByTemplate[t.id] ?? null,
        }))}
      />
    </>
  );
}
