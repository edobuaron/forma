import { GymSettings } from "@/components/community/gym-settings";
import { PageHeader } from "@/components/ui/misc";
import { getMyGym } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "My gym" };

export default async function GymPage() {
  const { supabase } = await requireUser();
  const { membership, gym } = await getMyGym(supabase);
  return (
    <>
      <PageHeader title="My gym" subtitle="Optional. You can skip this, change it or leave at any time." />
      <GymSettings gym={gym} membership={membership} />
    </>
  );
}
