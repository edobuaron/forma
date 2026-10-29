import { Plus, Upload } from "lucide-react";
import Link from "next/link";
import { CatalogBrowser } from "@/components/exercises/catalog-browser";
import { ExerciseFormButton } from "@/components/exercises/exercise-form";
import { ExerciseSearch } from "@/components/exercises/exercise-search";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { CATALOG } from "@/lib/catalog/catalog";
import { nameKey } from "@/lib/catalog/names";
import { listExercises } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Exercises" };

export default async function ExercisesPage({ searchParams }: { searchParams: Promise<{ archived?: string; view?: string; q?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const all = await listExercises(supabase, { includeArchived: true });
  const catalogView = sp.view === "catalog";
  const showArchived = sp.archived === "1";
  const list = all.filter((e) => (showArchived ? e.archived_at : !e.archived_at));
  const archivedCount = all.filter((e) => e.archived_at).length;
  const q = (sp.q ?? "").slice(0, 120);

  // Which catalog entries the library already has: linked by catalog slug, or by the same name or alias.
  const bySlug = new Map(all.filter((e) => e.catalog_slug).map((e) => [e.catalog_slug!, e]));
  const byKey = new Map(all.map((e) => [nameKey(e.name), e]));
  const owned: Record<string, { id: string; name: string; archived: boolean }> = {};
  for (const c of CATALOG) {
    const hit = bySlug.get(c.slug) ?? [c.name, ...c.aliases].map((n) => byKey.get(nameKey(n))).find(Boolean);
    if (hit) owned[c.slug] = { id: hit.id, name: hit.name, archived: !!hit.archived_at };
  }

  const tab = (active: boolean) => cn("h-9 rounded-[10px] px-4 text-[14px] font-semibold leading-9 text-muted-foreground transition-colors hover:text-foreground", active && "bg-primary text-primary-foreground shadow-sm hover:text-primary-foreground");
  return (
    <>
      <PageHeader
        title="Exercises"
        subtitle={catalogView ? `${CATALOG.length} in the catalog · ${Object.keys(owned).length} already in your library` : `${list.length} ${showArchived ? "archived" : "in your library"}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm"><Link href="/exercises/import"><Upload /> Import</Link></Button>
            <ExerciseFormButton variant="primary" size="sm"><Plus /> Create</ExerciseFormButton>
          </>
        }
      />
      <nav className="mb-5 inline-flex rounded-md border bg-muted p-0.5" aria-label="Exercise views">
        <Link href="/exercises" className={tab(!catalogView)} aria-current={!catalogView ? "page" : undefined}>Your library</Link>
        <Link href="/exercises?view=catalog" className={tab(catalogView)} aria-current={catalogView ? "page" : undefined}>Browse catalog</Link>
      </nav>
      {catalogView ? (
        <CatalogBrowser owned={owned} initialQuery={q} />
      ) : (
        <>
          <ExerciseSearch exercises={list} initialQuery={q} libraryEmpty={all.length === 0} />
          {archivedCount > 0 && (
            <Link href={showArchived ? "/exercises" : "/exercises?archived=1"} className="mt-6 block text-center text-[13px] text-muted-foreground hover:text-foreground">
              {showArchived ? "Show active exercises" : `Show ${archivedCount} archived`}
            </Link>
          )}
        </>
      )}
    </>
  );
}
