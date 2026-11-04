import { redirect } from "next/navigation";
import { ClubScreen } from "@/components/community/club";
import { feed, gymActivity } from "@/lib/data/posts";
import { getProfile } from "@/lib/data/queries";
import { getMyGym, gymCounts } from "@/lib/data/social";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Forma Club" };

export default async function ClubPage() {
  const { supabase, user } = await requireUser();
  const { gym, membership } = await getMyGym(supabase);
  if (!gym || !membership) redirect("/community/gym");
  const [counts, activity, posts, buddies, profile] = await Promise.all([
    gymCounts(supabase, gym.id), gymActivity(supabase, gym.id), feed(supabase, "gym"), feed(supabase, "buddy"), getProfile(supabase),
  ]);
  return (
    <ClubScreen gym={gym} discoverable={membership.discoverable} counts={counts} activity={activity}
      posts={posts.filter((p) => p.kind === "workout")} buddies={buddies} me={user.id} unit={profile.unit} distUnit={distanceUnit(profile)} />
  );
}
