import { Plus } from "lucide-react";
import Link from "next/link";
import { ExerciseFormButton } from "@/components/exercises/exercise-form";
import { ExerciseSearch } from "@/components/exercises/exercise-search";
import { PageHeader } from "@/components/ui/misc";
import { listExercises } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Exercises" };

export default async function ExercisesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const all = await listExercises(supabase, { includeArchived: true });
  const showArchived = sp.archived === "1";
  const list = all.filter((e) => (showArchived ? e.archived_at : !e.archived_at));
  const archivedCount = all.filter((e) => e.archived_at).length;
  return (
    <>
      <PageHeader
        title="Exercises"
        subtitle={`${list.length} ${showArchived ? "archived" : "in your library"}`}
        actions={<ExerciseFormButton variant="primary" size="sm"><Plus /> New</ExerciseFormButton>}
      />
      <ExerciseSearch exercises={list} />
      {archivedCount > 0 && (
        <Link href={showArchived ? "/exercises" : "/exercises?archived=1"} className="mt-6 block text-center text-[13px] text-muted-foreground hover:text-foreground">
          {showArchived ? "Show active exercises" : `Show ${archivedCount} archived`}
        </Link>
      )}
    </>
  );
}
