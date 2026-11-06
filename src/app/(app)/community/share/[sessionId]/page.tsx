import { notFound } from "next/navigation";
import { ShareWorkout } from "@/components/community/share-workout";
import { CommunityHeader } from "@/components/community/header";
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
      <CommunityHeader title="Share workout" back={{ href: "/community/share", label: "Back" }} showNav={false} />
      <p className="-mt-2 mb-5 text-[14px] text-muted-foreground">Your workout stays private. Sharing posts a separate copy, exactly as previewed.</p>
      <ShareWorkout sessionId={sessionId} gym={mine.gym} unit={profile.unit} distUnit={distanceUnit(profile)} sharedTo={existing.map((e) => e.audience)} />
    </>
  );
}
