import { FeedScreen } from "@/components/community/screens";
import { unreadTotal } from "@/lib/data/messages";
import { feed } from "@/lib/data/posts";
import { getProfile } from "@/lib/data/queries";
import { getMyGym, myFriends, myRequests, mySocialStatus } from "@/lib/data/social";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Community" };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "gym" ? "gym" : "friends";
  const { supabase, user } = await requireUser();
  const { gym, membership } = await getMyGym(supabase);
  const [posts, buddies, friends, requests, status, unread, profile] = await Promise.all([
    tab === "gym" ? (gym ? feed(supabase, "gym") : Promise.resolve([])) : feed(supabase, "friends"),
    tab === "gym" && gym ? feed(supabase, "buddy") : Promise.resolve([]),
    myFriends(supabase), myRequests(supabase), mySocialStatus(supabase), unreadTotal(supabase), getProfile(supabase),
  ]);
  return (
    <FeedScreen tab={tab} me={user.id} unit={profile.unit} distUnit={distanceUnit(profile)} unread={unread} restricted={status.restricted}
      friends={friends} incoming={requests.filter((r) => r.direction === "incoming")}
      posts={tab === "gym" ? posts.filter((p) => p.kind === "workout") : posts}
      gym={gym} membership={membership} buddies={buddies} />
  );
}
