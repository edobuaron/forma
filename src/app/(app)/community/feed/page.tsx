import { Users } from "lucide-react";
import Link from "next/link";
import { FeedList } from "@/components/community/post-card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { feed } from "@/lib/data/posts";
import { getProfile } from "@/lib/data/queries";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Friends feed" };

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const scope = tab === "mine" ? "mine" : "friends";
  const { supabase, user } = await requireUser();
  const [posts, profile] = await Promise.all([feed(supabase, scope), getProfile(supabase)]);
  const tabCls = (on: boolean) => cn("flex h-10 items-center rounded-md px-4 text-[14px] font-semibold", on ? "bg-card shadow-card" : "text-muted-foreground hover:text-foreground");
  return (
    <>
      <PageHeader title="Feed" subtitle="Workouts and invitations your friends chose to share with friends." />
      <Link href="/community" className="mb-4 inline-flex h-10 items-center text-[14px] font-medium text-muted-foreground hover:text-foreground">← Community</Link>
      <nav aria-label="Feed" className="mb-4 inline-flex rounded-lg bg-subtle p-1">
        <Link href="/community/feed" className={tabCls(scope === "friends")} aria-current={scope === "friends" ? "page" : undefined}>Friends</Link>
        <Link href="/community/feed?tab=mine" className={tabCls(scope === "mine")} aria-current={scope === "mine" ? "page" : undefined}>My posts</Link>
      </nav>
      <div className="max-w-2xl">
        <FeedList key={scope} posts={posts} me={user.id} unit={profile.unit} distUnit={distanceUnit(profile)} empty={
          <EmptyState icon={<Users />} title={scope === "mine" ? "You haven't shared anything" : "Nothing shared yet"}>
            {scope === "mine" ? "Open a finished workout in History and choose Share. Nothing is posted automatically." : "When friends share a workout with friends, it shows up here. Nothing is posted automatically."}
          </EmptyState>
        } />
      </div>
    </>
  );
}
