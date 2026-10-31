import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { ImportPlan } from "@/components/programs/plan-import/import-plan";
import { PageHeader } from "@/components/ui/misc";
import { listDrafts } from "@/lib/data/plan-import";
import { getProfile, listExercises, listPrograms } from "@/lib/data/queries";
import { providerStatus } from "@/lib/plan-import/document";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Import plan" };

export default async function ImportPlanPage() {
  const { supabase } = await requireUser();
  const [library, drafts, profile, programs] = await Promise.all([
    listExercises(supabase, { includeArchived: true }), listDrafts(supabase), getProfile(supabase), listPrograms(supabase),
  ]);
  return (
    <div>
      <Link href="/programs" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Programs</Link>
      <PageHeader title="Import plan" subtitle="Turn a trainer's plan into a new program. You check everything before it's created." />
      <ImportPlan library={library} drafts={drafts} unit={profile.unit} defaultRestS={profile.default_rest_s}
        hasActiveProgram={programs.some((p) => p.is_active)} documentsEnabled={providerStatus(process.env).enabled} />
    </div>
  );
}
