import { notFound } from "next/navigation";
import { ShareWorkout } from "@/components/community/share-workout";
import { PageHeader } from "@/components/ui/misc";
import { getProfile } from "@/lib/data/queries";
import { getMyGym } from "@/lib/data/social";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Share workout" };

export default async function SharePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { supabase } = await requireUser();
  const { data: s } = await supabase.from("workout_sessions").select("id, status").eq("id", sessionId).maybeSingle();
  if (!s || s.status !== "completed") notFound();
  const [profile, mine, existing] = await Promise.all([
    getProfile(supabase), getMyGym(supabase),
    supabase.from("posts").select("id, audience").eq("source_session_id", sessionId).then((r) => (r.data ?? []) as { id: string; audience: "friends" | "gym" }[]),
  ]);
  return (
    <>
      <PageHeader title="Share workout" subtitle="Check exactly what will be posted. Your workout stays private; this creates a separate copy." />
      <ShareWorkout sessionId={sessionId} gym={mine.gym} unit={profile.unit} distUnit={distanceUnit(profile)} sharedTo={existing.map((e) => e.audience)} />
    </>
  );
}
