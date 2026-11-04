import { CommunityHome } from "@/components/community/community-home";
import { PageHeader } from "@/components/ui/misc";
import { getMyGym, gymCounts, gymPeople, myBlocked, myFriends, myRequests, mySocialStatus } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Community" };

export default async function CommunityPage() {
  const { supabase } = await requireUser();
  const { membership, gym } = await getMyGym(supabase);
  const [counts, people, friends, requests, blocked, status] = await Promise.all([
    gym ? gymCounts(supabase, gym.id) : Promise.resolve(null),
    gym ? gymPeople(supabase, gym.id) : Promise.resolve([]),
    myFriends(supabase),
    myRequests(supabase),
    myBlocked(supabase),
    mySocialStatus(supabase),
  ]);
  return (
    <>
      <PageHeader title="Community" subtitle="Friends and your gym. Nothing from your workouts is shared unless you choose to." />
      <CommunityHome data={{ gym, membership, counts, people, friends, requests, blocked, restricted: status.restricted }} />
    </>
  );
}
