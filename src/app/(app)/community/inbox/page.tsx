import { InboxScreen } from "@/components/community/screens";
import { myConversations, unreadTotal } from "@/lib/data/messages";
import { myFriends, myRequests, mySocialStatus } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const { supabase } = await requireUser();
  const [conversations, friends, requests, status, unread] = await Promise.all([
    myConversations(supabase), myFriends(supabase), myRequests(supabase), mySocialStatus(supabase), unreadTotal(supabase),
  ]);
  return (
    <InboxScreen conversations={conversations} friends={friends} unread={unread} restricted={status.restricted}
      requests={requests.filter((r) => r.direction === "incoming").length} />
  );
}
