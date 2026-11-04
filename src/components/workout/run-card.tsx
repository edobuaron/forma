"use client";
import { ArrowUpDown, Check, Footprints, MoreHorizontal, Trash2 } from "lucide-react";
import { useId } from "react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Textarea } from "@/components/ui/input";
import {
  displayToMetres, formatPace, metresToDisplay, paceSeconds, planSummary, runProblem, settingLabel,
  type DistanceUnit, type RunSetting,
} from "@/lib/domain/running";
import type { SessionRunRow } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { DurationField } from "./duration-field";
import { NumberField } from "./number-field";

export type RunPatch = Partial<Pick<SessionRunRow, "duration_s" | "distance_m" | "effort" | "intervals_done" | "setting" | "notes" | "name">>;

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SETTINGS: (RunSetting | null)[] = ["outdoor", "treadmill", null];

/**
 * One run: the plan (if any) on top, what was actually run below. Pace appears only when both a
 * distance and a time are entered. Used live (with a Done control) and in History (always done).
 */
export function RunCard({
  run, unit, live, isFirst, isLast, active, onChange, onComplete, onReorder, onRemove,
}: {
  run: SessionRunRow; unit: DistanceUnit; live: boolean; isFirst: boolean; isLast: boolean; active?: boolean;
  onChange: (patch: RunPatch) => void; onComplete?: () => void; onReorder?: () => void; onRemove: () => void;
}) {
  const uid = useId();
  const plan = planSummary(run.prescribed, unit);
  const intervals = run.prescribed?.target_kind === "intervals";
  const pace = formatPace(paceSeconds(run.duration_s, run.distance_m, unit), unit);
  const problem = run.duration_s != null || run.distance_m != null ? runProblem(run) : null;
  const done = run.completed;

  return (
    <section aria-labelledby={`${uid}-t`} className={cn("rounded-xl border bg-card p-4 shadow-card md:p-5", done && live && "border-done/35", active && !done && "border-accent/45 ring-1 ring-accent/20")}>
      <div className="flex items-start gap-2">
        <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Footprints className="size-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <h2 id={`${uid}-t`} className="text-[18px] font-bold leading-snug tracking-[-0.02em]">{run.name}</h2>
          <p className="text-[12.5px] text-muted-foreground tabular">
            {plan ? <><span className="font-semibold">Planned</span> {plan}</> : "No target planned"}
          </p>
        </div>
        <Menu>
          <MenuTrigger aria-label={`${run.name} options`} className={cn("grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted", focusRing)}>
            <MoreHorizontal className="size-5" />
          </MenuTrigger>
          <MenuContent>
            {onReorder && <MenuItem disabled={isFirst && isLast} onSelect={onReorder}><ArrowUpDown /> Reorder exercises</MenuItem>}
            {onReorder && <MenuSeparator />}
            <MenuItem destructive onSelect={onRemove}><Trash2 /> Remove run</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {run.prescribed?.notes && <p className="mt-2 text-[13px] text-muted-foreground">{run.prescribed.notes}</p>}

      <p className="mb-1.5 mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Actual</p>
      <div className={cn("grid gap-2", intervals ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted-foreground">Time</span>
          <DurationField ariaLabel={`${run.name} time (minutes, or mm:ss, or h:mm:ss)`} value={run.duration_s} onCommit={(v) => onChange({ duration_s: v })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted-foreground">Distance ({unit})</span>
          <NumberField ariaLabel={`${run.name} distance in ${unit === "km" ? "kilometres" : "miles"}, optional`} placeholder="optional" max={unit === "km" ? 500 : 310}
            value={run.distance_m == null ? null : metresToDisplay(run.distance_m, unit)}
            onCommit={(v) => onChange({ distance_m: v == null || v === 0 ? null : displayToMetres(v, unit) })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted-foreground">Effort 1–10</span>
          <NumberField ariaLabel={`${run.name} perceived effort from 1 to 10, optional`} placeholder="—" min={1} max={10} integer
            value={run.effort} onCommit={(v) => onChange({ effort: v })} />
        </label>
        {intervals && (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted-foreground">Intervals done</span>
            <NumberField ariaLabel={`${run.name} intervals done, optional`} placeholder={run.prescribed.interval_count ? `of ${run.prescribed.interval_count}` : "—"} max={50} integer
              value={run.intervals_done} onCommit={(v) => onChange({ intervals_done: v })} />
          </label>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="radiogroup" aria-label="Where" className="inline-flex rounded-md border bg-muted p-0.5">
          {SETTINGS.map((s) => (
            <button key={s ?? "none"} type="button" role="radio" aria-checked={run.setting === s} onClick={() => onChange({ setting: s })}
              className={cn("h-9 rounded-[10px] px-3 text-[13px] font-semibold text-muted-foreground", focusRing, run.setting === s && "bg-primary text-primary-foreground")}>
              {s ? settingLabel[s] : "Not recorded"}
            </button>
          ))}
        </div>
        <p className="text-[13px] tabular text-muted-foreground" aria-live="polite">
          {pace ? <>Average pace <span className="font-semibold text-foreground">{pace}</span></> : run.duration_s && !run.distance_m ? "No pace without a distance" : null}
        </p>
      </div>
      {problem && <p role="alert" className="mt-2 text-[13px] text-negative">{problem}</p>}

      <Textarea aria-label={`${run.name} notes`} value={run.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value || null })} placeholder="Notes (route, conditions, how it felt)" className="mt-3 min-h-[44px] text-[14px]" />

      {live && onComplete && (
        <button type="button" aria-pressed={done} onClick={onComplete}
          className={cn("mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-lg text-[15px] font-semibold", focusRing,
            done ? "bg-done text-white dark:text-black" : "bg-subtle text-foreground hover:bg-muted")}>
          <Check className="size-5" strokeWidth={2.6} /> {done ? "Run done" : "Mark run done"}
        </button>
      )}
    </section>
  );
}
