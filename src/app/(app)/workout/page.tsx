import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { StartWorkout } from "@/components/workout/start-workout";
import { getActiveProgram, getInProgressSession, listSessions, toStartTemplates } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Start workout" };

export default async function StartPage() {
  const { supabase } = await requireUser();
  const inProgress = await getInProgressSession(supabase);
  if (inProgress) redirect(`/workout/${inProgress.id}`);
  const [program, recent] = await Promise.all([getActiveProgram(supabase), listSessions(supabase, { limit: 40 })]);

  return (
    <>
      <PageHeader title="Start workout" subtitle="Pick what you're training today" />
      <StartWorkout templates={toStartTemplates(program?.templates ?? [], recent)} />
    </>
  );
}
