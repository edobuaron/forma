"use client";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
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
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return exercises
      .filter((e) => !excludeIds.includes(e.id))
      .filter((e) => !s || e.name.toLowerCase().includes(s) || e.primary_muscles.some((m) => (MUSCLE_LABELS[m] ?? m).toLowerCase().includes(s)));
  }, [q, exercises, excludeIds]);

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQ(""); }}>
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
          {list.length === 0 && <p className="py-8 text-center text-[14px] text-muted-foreground">No matches. Create exercises in the library.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
