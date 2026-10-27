import { redirect } from "next/navigation";
import { Shell } from "@/components/app/shell";
import { getInProgressSession, isOnboarded } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await requireUser();
  const [s, onboarded] = await Promise.all([getInProgressSession(supabase), isOnboarded(supabase, user.id)]);
  if (!onboarded) redirect("/welcome");
  return <Shell inProgress={s ? { id: s.id, name: s.name } : null}>{children}</Shell>;
}
