import { ShareChooser } from "@/components/community/screens";
import { unreadTotal } from "@/lib/data/messages";
import { listSessions } from "@/lib/data/queries";
import { getMyGym, mySocialStatus } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Share" };

export default async function SharePickPage() {
  const { supabase } = await requireUser();
  const [sessions, mine, status, unread, shared] = await Promise.all([
    listSessions(supabase, { limit: 12 }), getMyGym(supabase), mySocialStatus(supabase), unreadTotal(supabase),
    supabase.from("posts").select("source_session_id").not("source_session_id", "is", null).then((r) => new Set((r.data ?? []).map((x) => x.source_session_id as string))),
  ]);
  return (
    <ShareChooser gym={mine.gym} unread={unread} restricted={status.restricted}
      sessions={sessions.map((s) => ({ id: s.id, name: s.name, started_at: s.started_at, exercise_count: s.exercise_count, set_count: s.set_count, shared: shared.has(s.id) }))} />
  );
}
