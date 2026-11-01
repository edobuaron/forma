import { notFound, redirect } from "next/navigation";
import { SessionEditor } from "@/components/history/session-editor";
import { getProfile, getSessionFull, listAttachments, listExercises, sessionRecords } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";
import { distanceUnit } from "@/lib/data/types";

export const metadata = { title: "Workout" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const session = await getSessionFull(supabase, id);
  if (!session) notFound();
  if (session.status === "in_progress") redirect(`/workout/${id}`);
  const [profile, library, records, attachments] = await Promise.all([
    getProfile(supabase), listExercises(supabase), sessionRecords(supabase, id), listAttachments(supabase, { includeArchived: true }),
  ]);
  return <SessionEditor session={session} unit={profile.unit} distUnit={distanceUnit(profile)} library={library} records={records} attachments={attachments} />;
}
