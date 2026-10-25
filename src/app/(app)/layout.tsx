import { Shell } from "@/components/app/shell";
import { getInProgressSession } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase } = await requireUser();
  const s = await getInProgressSession(supabase);
  return <Shell inProgress={s ? { id: s.id, name: s.name } : null}>{children}</Shell>;
}
