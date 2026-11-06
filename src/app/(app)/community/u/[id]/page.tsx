import { notFound, redirect } from "next/navigation";
import { PersonProfileScreen } from "@/components/community/screens";
import { unreadTotal } from "@/lib/data/messages";
import { profilePosts } from "@/lib/data/posts";
import { getProfile } from "@/lib/data/queries";
import { mySocialStatus, socialProfile } from "@/lib/data/social";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Profile" };

/** A profile opens only for someone the viewer already has a reason to see (social_profile() decides:
 *  friends, requests, conversations, opted-in members of the viewer's gym, authors of posts or comments
 *  the viewer can see). Nobody else can be looked up by id. */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, user } = await requireUser();
  if (id === user.id) redirect("/community/me");
  const [person, posts, status, unread, profile] = await Promise.all([
    socialProfile(supabase, id), profilePosts(supabase, id), mySocialStatus(supabase), unreadTotal(supabase), getProfile(supabase),
  ]);
  if (!person) notFound();
  return (
    <PersonProfileScreen me={user.id} unit={profile.unit} distUnit={distanceUnit(profile)} unread={unread} restricted={status.restricted}
      profile={person} posts={posts} />
  );
}
