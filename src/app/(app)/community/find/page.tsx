import { FindScreen } from "@/components/community/screens";
import { unreadTotal } from "@/lib/data/messages";
import { getMyGym, gymPeople, mySocialStatus } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Find friends" };

export default async function FindPage() {
  const { supabase } = await requireUser();
  const { gym, membership } = await getMyGym(supabase);
  const [people, status, unread] = await Promise.all([
    gym ? gymPeople(supabase, gym.id) : Promise.resolve([]), mySocialStatus(supabase), unreadTotal(supabase),
  ]);
  return <FindScreen gym={gym} membership={membership} people={people} restricted={status.restricted} unread={unread} />;
}
