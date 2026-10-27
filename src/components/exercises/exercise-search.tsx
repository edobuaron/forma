"use client";
import { BookOpen, ChevronRight, Plus, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { WEIGHT_ENTRY_SHORT } from "@/lib/catalog/conventions";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import type { ExerciseRow } from "@/lib/data/types";
import { ExerciseFormButton } from "./exercise-form";

const CAT_LABEL: Record<string, string> = { compound: "Compound", isolation: "Isolation", bodyweight: "Bodyweight", weighted_bodyweight: "Weighted BW", skill: "Skill" };

/** Name, alias or muscle match. Shared with the workout picker. */
export function matchesExercise(e: Pick<ExerciseRow, "name" | "aliases" | "primary_muscles" | "secondary_muscles">, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return e.name.toLowerCase().includes(s)
    || (e.aliases ?? []).some((a) => a.toLowerCase().includes(s))
    || [...e.primary_muscles, ...e.secondary_muscles].some((m) => (MUSCLE_LABELS[m] ?? m).toLowerCase().includes(s));
}

export function ExerciseSearch({ exercises, initialQuery = "", libraryEmpty = false }: { exercises: ExerciseRow[]; initialQuery?: string; libraryEmpty?: boolean }) {
  const [q, setQ] = useState(initialQuery);
  const [cat, setCat] = useState<string>("all");
  const list = useMemo(() => exercises.filter((e) => (cat === "all" || e.category === cat) && matchesExercise(e, q)), [q, cat, exercises]);

  if (libraryEmpty) {
    return (
      <EmptyState icon={<BookOpen />} title="Your library is empty"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="primary"><Link href="/exercises?view=catalog">Browse the catalog</Link></Button>
            <ExerciseFormButton variant="outline"><Plus /> Create exercise</ExerciseFormButton>
            <Button asChild variant="outline"><Link href="/exercises/import"><Upload /> Import CSV</Link></Button>
          </div>
        }>
        Add exercises from the built-in catalog, create your own, or import a list. Then add them to workouts under Programs.
      </EmptyState>
    );
  }

  const trimmed = q.trim();
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name or muscle" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Segmented value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, ...Object.entries(CAT_LABEL).map(([value, label]) => ({ value, label }))]} />
        </div>
      </div>
      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {list.map((e) => (
          <Link key={e.id} href={`/exercises/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{e.name}</p>
              <p className="truncate text-[13px] text-muted-foreground">
                {e.primary_muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(", ") || "—"} · {e.equipment} · {WEIGHT_ENTRY_SHORT[e.weight_convention] ?? e.weight_convention}
              </p>
            </div>
            <Badge tone="outline" className="hidden sm:inline-flex">{CAT_LABEL[e.category]}</Badge>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
        {list.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-[14px] text-muted-foreground">{trimmed ? <>No exercise in your library matches “{trimmed}”.</> : "No exercises match."}</p>
            {trimmed && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <ExerciseFormButton key={trimmed} initialName={trimmed} variant="primary" size="sm"><Plus /> Create “{trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed}”</ExerciseFormButton>
                <Button asChild variant="outline" size="sm"><Link href={`/exercises?view=catalog&q=${encodeURIComponent(trimmed)}`}>Search the catalog</Link></Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
