import { notFound, redirect } from "next/navigation";
import { PersonProfileScreen } from "@/components/community/screens";
import { unreadTotal } from "@/lib/data/messages";
import { feed } from "@/lib/data/posts";
import { getProfile } from "@/lib/data/queries";
import { getMyGym, gymPeople, myFriends, myRequests, mySocialStatus } from "@/lib/data/social";
import { distanceUnit } from "@/lib/data/types";
import type { Relation } from "@/lib/domain/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Profile" };

/** A profile opens only for someone you already have a connection with: a friend, a request, or a
 *  discoverable member of your gym. Nobody else can be looked up by id. */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, user } = await requireUser();
  if (id === user.id) redirect("/community/me");
  const { gym } = await getMyGym(supabase);
  const [friends, requests, people, status, unread, profile] = await Promise.all([
    myFriends(supabase), myRequests(supabase), gym ? gymPeople(supabase, gym.id) : Promise.resolve([]),
    mySocialStatus(supabase), unreadTotal(supabase), getProfile(supabase),
  ]);
  const friend = friends.find((f) => f.user_id === id);
  const request = requests.find((r) => r.other_id === id);
  const member = people.find((p) => p.user_id === id);
  const name = friend?.display_name ?? request?.display_name ?? member?.display_name;
  if (!name) notFound();
  const relation: Relation = friend ? "friends" : request ? (request.direction === "incoming" ? "request_received" : "request_sent") : member!.relation;
  const [fp, gp] = await Promise.all([friend ? feed(supabase, "friends") : Promise.resolve([]), gym ? feed(supabase, "gym") : Promise.resolve([])]);
  const seen = new Set<string>();
  const posts = [...fp, ...gp].filter((p) => p.author_id === id && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <PersonProfileScreen me={user.id} unit={profile.unit} distUnit={distanceUnit(profile)} unread={unread} restricted={status.restricted}
      person={{ id, name, relation, requestId: request?.direction === "incoming" ? request.id : undefined }}
      posts={posts} gymName={member ? gym?.name ?? null : null} />
  );
}
