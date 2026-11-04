import { Share2 } from "lucide-react";
import Link from "next/link";
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
  const editor = <SessionEditor session={session} unit={profile.unit} distUnit={distanceUnit(profile)} library={library} records={records} attachments={attachments} />;
  if (session.status !== "completed") return editor;
  // Sharing is opt-in and lives behind one small link; a shared post is a separate snapshot.
  const { data: shared } = await supabase.from("posts").select("audience").eq("source_session_id", id);
  const audiences = (shared ?? []).map((p: { audience: string }) => (p.audience === "gym" ? "gym community" : "friends"));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[13px]">
        {audiences.length > 0 && <span className="text-muted-foreground">Shared with {audiences.join(" and ")}. Edits here don&apos;t change the post.</span>}
        <Link href={`/community/share/${id}`} className="inline-flex h-10 items-center gap-1.5 rounded-md px-2 font-semibold text-accent hover:bg-muted"><Share2 className="size-4" /> Share</Link>
      </div>
      {editor}
    </>
  );
}
