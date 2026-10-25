import { notFound, redirect } from "next/navigation";
import { SessionEditor } from "@/components/history/session-editor";
import { getProfile, getSessionFull, listExercises, sessionRecords } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Workout" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const session = await getSessionFull(supabase, id);
  if (!session) notFound();
  if (session.status === "in_progress") redirect(`/workout/${id}`);
  const [profile, library, records] = await Promise.all([getProfile(supabase), listExercises(supabase), sessionRecords(supabase, id)]);
  return <SessionEditor session={session} unit={profile.unit} library={library} records={records} />;
}
