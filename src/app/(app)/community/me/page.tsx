import { MyProfileScreen } from "@/components/community/screens";
import { unreadTotal } from "@/lib/data/messages";
import { feed } from "@/lib/data/posts";
import { getProfile } from "@/lib/data/queries";
import { getMyGym, myBlocked, myFriends, myRequests, mySocialStatus, socialProfile } from "@/lib/data/social";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Profile" };

export default async function MyProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab === "friends" ? "friends" : "posts";
  const { supabase, user } = await requireUser();
  const [profile, posts, friends, requests, blocked, status, unread, mine, social] = await Promise.all([
    getProfile(supabase), feed(supabase, "mine"), myFriends(supabase), myRequests(supabase), myBlocked(supabase),
    mySocialStatus(supabase), unreadTotal(supabase), getMyGym(supabase), socialProfile(supabase, user.id),
  ]);
  return (
    <MyProfileScreen me={user.id} profile={social ?? { id: user.id, display_name: profile.display_name || "You", interests: [], relation: "self", can_request: false, can_message: false }} tab={tab} unit={profile.unit} distUnit={distanceUnit(profile)}
      unread={unread} restricted={status.restricted} friends={friends} requests={requests} blocked={blocked} posts={posts} gym={mine.gym} />
  );
}
