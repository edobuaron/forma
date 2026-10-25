"use client";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { workingSets } from "@/lib/domain/sets";
import type { ExerciseConfig, ExercisePerformance, WeightUnit } from "@/lib/domain/types";
import { formatSetLong } from "./format";

export function PreviousSessionSheet({
  open, onOpenChange, ex, history, unit,
}: { open: boolean; onOpenChange: (o: boolean) => void; ex: ExerciseConfig; history: ExercisePerformance[]; unit: WeightUnit }) {
  const sessions = history.filter((h) => workingSets(h.sets).length > 0).slice(0, 4);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={ex.name} description="Recent sessions">
        {sessions.length === 0 && <p className="py-6 text-[14px] text-muted-foreground">No completed sessions yet.</p>}
        <div className="space-y-5">
          {sessions.map((s, i) => (
            <div key={s.sessionId}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[13px] font-medium">
                  {i === 0 ? "Last time · " : ""}
                  <span className="text-muted-foreground">{format(new Date(s.date), "EEE d MMM yyyy")}</span>
                </p>
                <Link href={`/history/${s.sessionId}`} className="flex items-center gap-1 text-[12px] text-accent">
                  Session <ExternalLink className="size-3" />
                </Link>
              </div>
              <div className="overflow-hidden rounded-md border">
                {s.sets.filter((x) => x.completed).map((x, j) => (
                  <div key={j} className="flex items-center justify-between border-b px-3 py-2 text-[14px] last:border-0">
                    <span className="w-14 text-muted-foreground">{x.kind === "warmup" ? "Warm-up" : `Set ${s.sets.filter((y) => y.kind === "working" && y.completed).indexOf(x) + 1}`}</span>
                    <span className="flex-1 font-medium tabular">{formatSetLong(x, ex.loadType, unit)}</span>
                    {x.rir != null && <span className="text-[12px] text-muted-foreground tabular">RIR {x.rir}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
