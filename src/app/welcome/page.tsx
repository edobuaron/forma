import { redirect } from "next/navigation";
import { SetupForm } from "@/components/onboarding/setup-form";
import { getProfile, isOnboarded, listPrograms } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const { supabase, user } = await requireUser();
  if (await isOnboarded(supabase, user.id)) redirect("/");
  const [profile, programs] = await Promise.all([getProfile(supabase), listPrograms(supabase)]);
  return (
    <div className="pt-safe flex min-h-dvh justify-center px-4 py-10">
      <div className="w-full max-w-[520px]">
        <SetupForm initialName={profile.display_name ?? ""} initialUnit={profile.unit} hasStarter={programs.some((p) => p.starter_version != null)} />
      </div>
    </div>
  );
}
