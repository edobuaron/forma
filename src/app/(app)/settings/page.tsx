import { SettingsForm } from "@/components/settings/settings-form";
import { PageHeader } from "@/components/ui/misc";
import { getProfile } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase, user } = await requireUser();
  const profile = await getProfile(supabase);
  return (
    <>
      <PageHeader title="Settings" subtitle={user.email} />
      {error === "signout" && <p role="alert" className="mb-4 text-sm text-negative">Could not sign out. Please try again.</p>}
      <SettingsForm profile={profile} email={user.email} />
    </>
  );
}
