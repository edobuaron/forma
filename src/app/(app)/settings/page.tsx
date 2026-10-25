import { SettingsForm } from "@/components/settings/settings-form";
import { PageHeader } from "@/components/ui/misc";
import { getProfile } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { supabase, user } = await requireUser();
  const profile = await getProfile(supabase);
  return (
    <>
      <PageHeader title="Settings" subtitle={user.email} />
      <SettingsForm profile={profile} />
    </>
  );
}
