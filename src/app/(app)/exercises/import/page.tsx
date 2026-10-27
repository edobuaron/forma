import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { ImportExercises } from "@/components/exercises/import-exercises";
import { PageHeader } from "@/components/ui/misc";
import { listExercises } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Import exercises" };

export default async function ImportPage() {
  const { supabase } = await requireUser();
  const all = await listExercises(supabase, { includeArchived: true });
  return (
    <div>
      <Link href="/exercises" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Exercises</Link>
      <PageHeader title="Import exercises" subtitle="Add your own exercise list from a CSV file. Nothing is saved until you confirm." />
      <ImportExercises existing={all.map((e) => ({ name: e.name, archived: !!e.archived_at }))} />
    </div>
  );
}
