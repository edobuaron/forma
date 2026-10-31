"use client";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { attachmentLabel, performedSets, sideAsSet, sideShort, SIDES } from "@/lib/domain/sides";
import type { ExerciseConfig, ExercisePerformance, WeightUnit } from "@/lib/domain/types";
import { formatSetLong } from "./format";

export function PreviousSessionSheet({
  open, onOpenChange, ex, history, unit,
}: { open: boolean; onOpenChange: (o: boolean) => void; ex: ExerciseConfig; history: ExercisePerformance[]; unit: WeightUnit }) {
  const sessions = history.filter((h) => performedSets(h.sets, ex).length > 0).slice(0, 4);
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
                  {s.attachment?.state && <span className="text-muted-foreground"> · {attachmentLabel(s.attachment)}</span>}
                </p>
                <Link href={`/history/${s.sessionId}`} className="flex items-center gap-1 text-[12px] text-accent">
                  Session <ExternalLink className="size-3" />
                </Link>
              </div>
              <div className="overflow-hidden rounded-md border">
                {s.sets.filter((x) => x.completed).map((x, j) => (
                  <div key={j} className="flex items-center justify-between border-b px-3 py-2 text-[14px] last:border-0">
                    <span className="w-14 text-muted-foreground">{x.kind === "warmup" ? "Warm-up" : x.kind === "drop" ? "↳ Drop" : `Set ${s.sets.filter((y) => y.kind === "working" && y.completed).indexOf(x) + 1}`}</span>
                    {x.sides ? (
                      <span className="flex flex-1 flex-col font-medium tabular">
                        {SIDES.map((sd) => {
                          const v = sideAsSet(x, sd);
                          return (
                            <span key={sd}>
                              <span className="mr-1.5 text-[12px] text-muted-foreground">{sideShort[sd]}</span>
                              {v.completed ? formatSetLong(v, ex.loadType, unit) : <span className="font-normal text-muted-foreground">not done</span>}
                              {v.completed && v.rir != null && <span className="ml-2 text-[12px] font-normal text-muted-foreground">RIR {v.rir}</span>}
                            </span>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="flex-1 font-medium tabular">{formatSetLong(x, ex.loadType, unit)}</span>
                    )}
                    {!x.sides && x.rir != null && <span className="text-[12px] text-muted-foreground tabular">RIR {x.rir}</span>}
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
