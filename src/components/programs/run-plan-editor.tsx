"use client";
import { ArrowDown, ArrowUp, Footprints, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { DurationField } from "@/components/workout/duration-field";
import { NumberField } from "@/components/workout/number-field";
import { displayToMetres, metresToDisplay, normalizePlan, planProblem, settingLabel, type DistanceUnit, type RunTargetKind } from "@/lib/domain/running";
import type { TemplateRunRow } from "@/lib/data/types";

const KINDS: { value: RunTargetKind; label: string }[] = [
  { value: "open", label: "No target" }, { value: "time", label: "Time" }, { value: "distance", label: "Distance" }, { value: "intervals", label: "Intervals" },
];

/** A planned run in a program workout. Only the fields of the chosen target are kept. */
export function RunPlanEditor({ run, unit, index, isFirst, isLast, onChange, onMove, onRemove, bare = false }: {
  run: TemplateRunRow; unit: DistanceUnit; index: number; isFirst: boolean; isLast: boolean;
  /** Inside another row that already shows the number and the move/remove controls. */
  bare?: boolean;
  onChange: (patch: Partial<TemplateRunRow>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const problem = planProblem(run);
  const dist = (m: number | null) => (m == null ? null : metresToDisplay(m, unit));
  const toM = (v: number | null) => (v == null || v === 0 ? null : displayToMetres(v, unit));
  const label = (t: string) => <span className="text-[11.5px] font-medium text-muted-foreground">{t}</span>;
  return (
    <div className={bare ? "" : "rounded-md border bg-muted/40 p-3"}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {!bare && <span className="w-5 text-[12px] font-semibold text-muted-foreground tabular">{index}</span>}
        <Footprints aria-hidden className="size-4 text-accent" />
        <Input value={run.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Run name" className="h-8 min-w-[8rem] flex-1 text-[14px] font-semibold" />
        {!bare && <span className="ml-auto flex items-center">
          <button aria-label="Move up" disabled={isFirst} onClick={() => onMove(-1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" /></button>
          <button aria-label="Move down" disabled={isLast} onClick={() => onMove(1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" /></button>
          <button aria-label="Remove run" onClick={onRemove} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-4" /></button>
        </span>}
      </div>
      <div className={bare ? "space-y-2" : "space-y-2 pl-7"}>
        <Segmented size="sm" className="max-w-full overflow-x-auto" value={run.target_kind} options={KINDS} onChange={(k) => onChange(normalizePlan({ ...run, target_kind: k }) as Partial<TemplateRunRow>)} />
        {run.target_kind === "time" && (
          <label className="flex max-w-[10rem] flex-col gap-1">{label("Planned time")}
            <DurationField ariaLabel="Planned time" value={run.target_duration_s} onCommit={(v) => onChange({ target_duration_s: v })} className="h-9 text-[14px]" />
          </label>
        )}
        {run.target_kind === "distance" && (
          <label className="flex max-w-[10rem] flex-col gap-1">{label(`Planned distance (${unit})`)}
            <NumberField ariaLabel={`Planned distance in ${unit}`} max={unit === "km" ? 500 : 310} value={dist(run.target_distance_m)} onCommit={(v) => onChange({ target_distance_m: toM(v) })} className="h-9 text-[14px]" />
          </label>
        )}
        {run.target_kind === "intervals" && (
          <div className="grid max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex flex-col gap-1">{label("Repeats")}
              <NumberField ariaLabel="Interval repeats" integer min={1} max={50} value={run.interval_count} onCommit={(v) => onChange({ interval_count: v })} className="h-9 text-[14px]" />
            </label>
            <label className="flex flex-col gap-1">{label("Work time")}
              <DurationField ariaLabel="Work time per interval (leave empty for a distance)" value={run.interval_work_s} onCommit={(v) => onChange({ interval_work_s: v, ...(v != null ? { interval_work_m: null } : {}) })} className="h-9 text-[14px]" />
            </label>
            <label className="flex flex-col gap-1">{label(`or distance (${unit === "km" ? "m" : "mi"})`)}
              <NumberField ariaLabel={`Work distance per interval in ${unit === "km" ? "metres" : "miles"}`} max={unit === "km" ? 50000 : 31}
                value={run.interval_work_m == null ? null : unit === "km" ? Math.round(run.interval_work_m) : metresToDisplay(run.interval_work_m, "mi")}
                onCommit={(v) => onChange({ interval_work_m: v == null || v === 0 ? null : unit === "km" ? v : displayToMetres(v, "mi"), ...(v ? { interval_work_s: null } : {}) })} className="h-9 text-[14px]" />
            </label>
            <label className="flex flex-col gap-1">{label("Recovery")}
              <DurationField ariaLabel="Recovery time between intervals" value={run.interval_recovery_s} onCommit={(v) => onChange({ interval_recovery_s: v })} className="h-9 text-[14px]" />
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Segmented size="sm" value={run.setting ?? "any"} onChange={(v) => onChange({ setting: v === "any" ? null : v })}
            options={[{ value: "any", label: "Anywhere" }, { value: "outdoor", label: settingLabel.outdoor }, { value: "treadmill", label: settingLabel.treadmill }]} />
          <label className="flex items-center gap-2 text-[12px] text-muted-foreground">Optional <Switch checked={run.optional} onCheckedChange={(c) => onChange({ optional: c })} /></label>
        </div>
        <Input value={run.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value || null })} placeholder="Notes (easy pace, hills…)" className="h-8 text-[13px]" />
        {problem && <p role="alert" className="text-[12.5px] text-negative">{problem}</p>}
      </div>
    </div>
  );
}
