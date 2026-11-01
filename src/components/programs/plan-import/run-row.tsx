"use client";
import { AlertTriangle, ArrowDown, ArrowUp, Footprints, Info, Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RunPlanEditor } from "@/components/programs/run-plan-editor";
import { planText, type DistanceUnit } from "@/lib/domain/running";
import { acknowledge, applyOption, editRun, exerciseProblems, treatAsExercise } from "@/lib/plan-import/review";
import type { DraftExercise } from "@/lib/plan-import/types";
import type { TemplateRunRow } from "@/lib/data/types";
import { cn } from "@/lib/utils";

/** A plan row read as a running prescription. Questions stay visible until answered; "Not a run" undoes the reading. */
export function RunRowEditor({ ex, index, count, unit, onChange, onMove }: {
  ex: DraftExercise; index: number; count: number; unit: DistanceUnit;
  onChange: (next: DraftExercise) => void; onMove: (dir: -1 | 1) => void;
}) {
  const run = ex.run!;
  const problems = exerciseProblems(ex);
  const open = (ex.runFlags ?? []).filter((f) => !f.resolved);
  const asRow: TemplateRunRow = { id: ex.id, template_id: "", position: index, optional: ex.optional, notes: ex.runNotes ?? null, ...run };
  const target = planText(run, unit);

  return (
    <div className={cn("rounded-md border bg-muted/40 p-3", ex.skipped && "opacity-60", !ex.skipped && problems.length > 0 && "border-negative/40")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-5 text-[12px] font-semibold text-muted-foreground tabular">{index + 1}</span>
        <Badge tone="accent"><Footprints /> Run{target ? ` · ${target}` : ""}</Badge>
        <span className="ml-auto flex items-center">
          <button aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" /></button>
          <button aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" /></button>
          <Button size="sm" variant="quiet" onClick={() => onChange(treatAsExercise(ex))}>Not a run</Button>
          <Button size="sm" variant="quiet" onClick={() => onChange({ ...ex, skipped: !ex.skipped })}>{ex.skipped ? <><Undo2 /> Include</> : "Leave out"}</Button>
        </span>
      </div>
      {!ex.skipped && (
        <div className="mt-2 space-y-2 pl-7">
          <RunPlanEditor run={asRow} unit={unit} index={index + 1} isFirst isLast
            onChange={(patch) => {
              const { optional, notes, ...rest } = patch;
              let next = editRun(ex, rest);
              if (optional !== undefined) next = { ...next, optional };
              if (notes !== undefined) next = { ...next, runNotes: notes };
              onChange(next);
            }}
            onMove={onMove} onRemove={() => onChange({ ...ex, skipped: true })} bare />
          {open.map((f) => (
            <div key={f.id} className={cn("rounded-md px-3 py-2 text-[12.5px]", f.blocking ? "bg-negative/10" : "bg-muted")}>
              <p className={cn("flex items-start gap-1.5", f.blocking ? "text-negative" : "text-muted-foreground")}>
                {f.blocking ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}<span>{f.message}</span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
                {f.options?.map((o, i) => <Button key={o.label} size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => onChange(applyOption(ex, f.id, i))}>{o.label}</Button>)}
                {!f.blocking && <Button size="sm" variant="quiet" className="h-7 text-[12px]" onClick={() => onChange(acknowledge(ex, f.id))}><Check /> OK</Button>}
              </div>
            </div>
          ))}
          {ex.original.length > 0 && (
            <p className="text-[12px] text-muted-foreground">Original · {ex.source.label}: {ex.original.map((o) => o.text).join(" · ")}</p>
          )}
          {problems.length > 0 && open.length === 0 && <ul className="text-[12.5px] text-negative">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
