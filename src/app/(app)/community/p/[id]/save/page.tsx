import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty } from "@/components/community/common";
import { CommunityHeader } from "@/components/community/header";
import { SaveWorkoutScreen } from "@/components/community/save-workout";
import { Button } from "@/components/ui/button";
import { isSaveable, mySavesOf, type WorkoutSnapshot } from "@/lib/data/posts";
import { getProfile } from "@/lib/data/queries";
import { socialProfile } from "@/lib/data/social";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Save workout" };

/** Review a shared workout's plan before saving a copy. The post is read through RLS, so only viewers
 *  who can see it get here; the recipient's library and programs are their own rows. */
export default async function SavePostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, user } = await requireUser();
  const { data: post } = await supabase.from("posts").select("id, author_id, kind, snapshot, created_at").eq("id", id).maybeSingle();
  if (!post) notFound();
  const header = <div className="mx-auto max-w-[680px]"><CommunityHeader title="Save to my programs" back={{ href: "/community", label: "Back to Community" }} showNav={false} /></div>;
  const snap = post.snapshot as WorkoutSnapshot | null;
  if (!snap || !isSaveable({ kind: post.kind, snapshot: snap }) || post.author_id === user.id) {
    return (
      <>
        {header}
        <Empty title="This workout can't be saved" actions={<Button asChild variant="primary"><Link href="/community">Back to Community</Link></Button>}>
          {post.author_id === user.id ? "It's already yours." : "Its author didn't share the plan."}
        </Empty>
      </>
    );
  }
  const [author, library, programs, saves, profile] = await Promise.all([
    socialProfile(supabase, post.author_id),
    supabase.from("exercises").select("id, name, aliases, archived_at, catalog_slug").eq("user_id", user.id)
      .then((r) => (r.data ?? []).map((e) => ({ id: e.id as string, name: e.name as string, aliases: (e.aliases as string[] | null) ?? [], archived: !!e.archived_at, catalogSlug: e.catalog_slug as string | null }))),
    supabase.from("programs").select("id, name, is_active").eq("user_id", user.id).is("archived_at", null).order("is_active", { ascending: false }).order("created_at")
      .then((r) => (r.data ?? []) as { id: string; name: string; is_active: boolean }[]),
    mySavesOf(supabase, id),
    getProfile(supabase),
  ]);
  return (
    <>
      {header}
      <SaveWorkoutScreen postId={id} author={{ id: post.author_id, name: author?.display_name ?? "Forma member", avatar: author?.avatar ?? null }}
        sharedAt={post.created_at} snapshot={snap} library={library} programs={programs} previousSaves={saves}
        unit={profile.unit} distUnit={distanceUnit(profile)} />
    </>
  );
}
