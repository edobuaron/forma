import { BodyTracker } from "@/components/body/body-tracker";
import { PageHeader } from "@/components/ui/misc";
import { getProfile, listMeasurements } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Body" };

export default async function BodyPage() {
  const { supabase } = await requireUser();
  const [profile, rows] = await Promise.all([getProfile(supabase), listMeasurements(supabase)]);
  return (
    <>
      <PageHeader title="Body" subtitle="Optional. For legs, stability is the goal — not growth." />
      <BodyTracker rows={rows} unit={profile.unit} profileId={profile.id} />
    </>
  );
}
