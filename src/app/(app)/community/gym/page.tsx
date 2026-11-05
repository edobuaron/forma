import { GymSettings } from "@/components/community/gym-settings";
import { CommunityHeader } from "@/components/community/header";
import { getMyGym } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "My gym" };

export default async function GymPage() {
  const { supabase } = await requireUser();
  const { membership, gym } = await getMyGym(supabase);
  return (
    <>
      <CommunityHeader title="My gym" back={{ href: "/community?tab=gym", label: "Back to Community" }} showNav={false} />
      <GymSettings gym={gym} membership={membership} />
    </>
  );
}
