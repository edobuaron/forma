"use client";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ExerciseForm } from "@/components/exercises/exercise-form";
import { matchesExercise } from "@/components/exercises/exercise-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import type { ExerciseRow } from "@/lib/data/types";

export function ExercisePicker({
  open, onOpenChange, exercises, onPick, title = "Add exercise", excludeIds = [],
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  exercises: ExerciseRow[];
  onPick: (e: ExerciseRow) => void;
  title?: string;
  excludeIds?: string[];
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useMemo(
    () => exercises.filter((e) => !excludeIds.includes(e.id)).filter((e) => matchesExercise(e, q)),
    [q, exercises, excludeIds],
  );
  const trimmed = q.trim();

  return (
    <>
      <Sheet open={open && !creating} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}>
        <SheetContent title={title} className="sm:h-[70vh]">
          <div className="sticky top-0 -mx-5 bg-card px-5 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus placeholder="Search exercises or muscles" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" />
            </div>
          </div>
          <div className="divide-y">
            {list.map((e) => (
              <button
                key={e.id}
                onClick={() => { onPick(e); onOpenChange(false); setQ(""); }}
                className="flex w-full items-center justify-between gap-3 py-3 text-left active:bg-muted"
              >
                <span>
                  <span className="block text-[15px] font-medium">{e.name}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {e.primary_muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(", ")} · {e.equipment}
                  </span>
                </span>
              </button>
            ))}
            {list.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-[14px] text-muted-foreground">
                  {exercises.length === 0 ? "Your exercise library is empty." : trimmed ? `Nothing in your library matches “${trimmed}”.` : "No matches."}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                    <Plus /> {trimmed ? `Create “${trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed}”` : "Create exercise"}
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/exercises?view=catalog${trimmed ? `&q=${encodeURIComponent(trimmed)}` : ""}`}>Browse the catalog</Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      {creating && (
        <ExerciseForm
          open
          initialName={trimmed}
          onOpenChange={(o) => { if (!o) setCreating(false); }}
          onCreated={(row) => { setCreating(false); setQ(""); onPick(row); onOpenChange(false); }}
        />
      )}
    </>
  );
}
