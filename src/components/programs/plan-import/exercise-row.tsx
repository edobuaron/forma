"use client";
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, Info, Plus, Search, Undo2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { kgToDisplay, displayToKg } from "@/lib/domain/units";
import type { WeightUnit } from "@/lib/domain/types";
import { fmtRest } from "@/lib/plan-import/notation";
import { acknowledge, applyOption, chooseExercise, editExercise, exerciseProblems } from "@/lib/plan-import/review";
import type { DraftExercise, DraftValues, ExerciseChoice, Flag, Origin } from "@/lib/plan-import/types";
import { cn } from "@/lib/utils";

const ORIGIN_NOTE: Partial<Record<Origin, string>> = { interpreted: "interpreted", edited: "edited" };

function NumField({ label, value, onChange, step = 1, missing, origin, hint, className }: {
  label: string; value: number | null; onChange: (v: number | null) => void; step?: number; missing?: boolean;
  origin?: Origin; hint?: string; className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null ? "" : String(value));
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="truncate text-[11.5px] font-medium text-muted-foreground" title={origin && ORIGIN_NOTE[origin] ? `${label}: ${ORIGIN_NOTE[origin]}` : undefined}>
        {label}
        {origin === "interpreted" && <span className="sr-only"> (interpreted, check it)</span>}
      </span>
      <input
        inputMode={step < 1 ? "decimal" : "numeric"}
        value={shown}
        aria-invalid={missing || undefined}
        onChange={(e) => {
          const s = e.target.value;
          setText(s);
          const t = s.replace(",", ".").trim();
          if (t === "") onChange(null);
          else if (/^\d+(\.\d+)?$/.test(t)) onChange(Number(t));
        }}
        onBlur={() => setText(null)}
        className={cn(
          "h-9 w-full rounded-sm border border-input bg-card px-2 text-center text-[14px] tabular outline-none focus:ring-2 focus:ring-ring",
          missing && "border-negative/70 bg-negative/5",
          origin === "interpreted" && !missing && "border-dashed border-accent/60",
        )}
      />
      {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function FlagLine({ f, onOption, onAck }: { f: Flag; onOption: (i: number) => void; onAck: () => void }) {
  return (
    <div className={cn("rounded-md px-3 py-2 text-[12.5px]", f.blocking ? "bg-negative/10" : "bg-muted")}>
      <p className={cn("flex items-start gap-1.5", f.blocking ? "text-negative" : "text-muted-foreground")}>
        {f.blocking ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
        <span>{f.message}</span>
      </p>
      {(f.options?.length || !f.blocking) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-5">
          {f.options?.map((o, i) => (
            <Button key={o.label} size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => onOption(i)}>{o.label}</Button>
          ))}
          {!f.blocking && <Button size="sm" variant="quiet" className="h-7 text-[12px]" onClick={onAck}><Check /> OK</Button>}
        </div>
      )}
    </div>
  );
}

function choiceLabel(c: ExerciseChoice) {
  return c.kind === "catalog" ? `${c.name} (catalog)` : c.name;
}

export function ExerciseRowEditor({ ex, index, count, unit, defaultRestS, onChange, onMove, onPickLibrary, onCreate }: {
  ex: DraftExercise;
  index: number;
  count: number;
  unit: WeightUnit;
  defaultRestS: number;
  onChange: (next: DraftExercise) => void;
  onMove: (dir: -1 | 1) => void;
  onPickLibrary: () => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const problems = exerciseProblems(ex);
  const openFlags = ex.flags.filter((f) => !f.resolved && f.field !== "exercise");
  const edit = (patch: Partial<DraftValues>) => onChange(editExercise(ex, patch));
  const missing = (k: "sets" | "reps") => problems.some((p) => (k === "sets" ? p.startsWith("Sets") : p.startsWith("Reps")) || ex.flags.some((f) => !f.resolved && f.blocking && f.field === k));
  const m = ex.match;

  return (
    <div className={cn("rounded-md border bg-muted/40 p-3", ex.skipped && "opacity-60", !ex.skipped && problems.length > 0 && "border-negative/40")}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <span className="w-5 pt-2 text-[12px] font-semibold text-muted-foreground tabular">{index + 1}</span>
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          <Input value={ex.name} onChange={(e) => onChange({ ...ex, name: e.target.value.slice(0, 120), origin: { ...ex.origin, name: "edited" } })}
            aria-label={`Exercise name as written, row ${index + 1}`} className={cn("h-9 text-[14px] font-semibold", ex.skipped && "line-through")} />
          {/* Exercise match: confirmed, proposed (needs confirmation) or none. */}
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {m.status === "confirmed" && m.choice && <Badge tone="positive"><Check /> {choiceLabel(m.choice)}</Badge>}
            {m.status === "proposed" && m.choice && (
              <>
                <Badge tone="accent">Proposed: {choiceLabel(m.choice)}</Badge>
                <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => onChange(chooseExercise(ex, m.choice!))}><Check /> Confirm</Button>
              </>
            )}
            {m.status === "none" && <Badge tone="negative">No match</Badge>}
            {m.candidates.filter((c) => !(m.choice && sameChoice(c.choice, m.choice))).slice(0, 4).map((c) => (
              <button key={keyOf(c.choice)} type="button" onClick={() => onChange(chooseExercise(ex, c.choice))}
                className="rounded-full border px-2 py-0.5 text-[12px] text-muted-foreground hover:border-accent/50 hover:text-foreground">
                {choiceLabel(c.choice)}{c.quality === "similar" ? "?" : ""}
              </button>
            ))}
            <button type="button" onClick={onPickLibrary} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium text-accent"><Search className="size-3" /> Choose</button>
            <button type="button" onClick={onCreate} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium text-accent"><Plus className="size-3" /> Create custom exercise</button>
          </div>
        </div>
        <span className="ml-auto flex items-center">
          <button aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" /></button>
          <button aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" /></button>
          <Button size="sm" variant="quiet" onClick={() => onChange({ ...ex, skipped: !ex.skipped })}>{ex.skipped ? <><Undo2 /> Include</> : "Leave out"}</Button>
        </span>
      </div>

      {!ex.skipped && (
        <div className="mt-2 space-y-2 pl-7">
          <div className="grid max-w-xl grid-cols-3 gap-2 sm:grid-cols-6">
            <NumField label="Sets" value={ex.sets} onChange={(v) => edit({ sets: v })} missing={missing("sets")} origin={ex.origin.sets} />
            <NumField label="Reps min" value={ex.repMin} onChange={(v) => edit({ repMin: v, ...(ex.repMax == null || (v != null && v > ex.repMax) ? { repMax: v } : {}) })} missing={missing("reps")} origin={ex.origin.repMin} />
            <NumField label="Reps max" value={ex.repMax} onChange={(v) => edit({ repMax: v })} missing={missing("reps")} origin={ex.origin.repMax} />
            <NumField label="Rest (s)" value={ex.restS} onChange={(v) => edit({ restS: v })} origin={ex.origin.restS}
              missing={ex.flags.some((f) => !f.resolved && f.blocking && f.field === "rest")}
              hint={ex.restS != null ? fmtRest(ex.restS) : `default ${fmtRest(defaultRestS)}`} />
            <NumField label="RIR" value={ex.targetRir} step={0.5} onChange={(v) => edit({ targetRir: v })} origin={ex.origin.targetRir}
              missing={ex.flags.some((f) => !f.resolved && f.blocking && f.field === "effort")} />
            <NumField label="RPE" value={ex.targetRpe} step={0.5} onChange={(v) => edit({ targetRpe: v })} origin={ex.origin.targetRpe}
              missing={ex.flags.some((f) => !f.resolved && f.blocking && f.field === "effort")} />
          </div>
          {ex.perSide && <p className="text-[12px] text-muted-foreground">Reps are per side · {ex.sets ?? "?"} planned set{ex.sets === 1 ? "" : "s"}</p>}

          {openFlags.length > 0 && (
            <div className="space-y-1.5">
              {openFlags.map((f) => (
                <FlagLine key={f.id} f={f} onOption={(i) => onChange(applyOption(ex, f.id, i))} onAck={() => onChange(acknowledge(ex, f.id))} />
              ))}
            </div>
          )}

          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
            More: load, warm-ups, drop sets, tempo, superset, notes, original
            {summaryBits(ex, unit).length > 0 && <span className="font-normal">· {summaryBits(ex, unit).join(" · ")}</span>}
          </button>
          {open && (
            <div className="space-y-2">
              <div className="grid max-w-xl grid-cols-3 gap-2 sm:grid-cols-6">
                <NumField label={`Load (${unit})`} step={0.5} value={ex.loadKg == null ? null : kgToDisplay(ex.loadKg, unit)}
                  onChange={(v) => edit({ loadKg: v == null ? null : displayToKg(v, unit) })} origin={ex.origin.loadKg} />
                <NumField label="Warm-up sets" value={ex.warmupSets} onChange={(v) => edit({ warmupSets: v ?? 0 })} origin={ex.origin.warmupSets} />
                <NumField label="Drops" value={ex.dropSegments} onChange={(v) => edit({ dropSegments: v ?? 0 })} origin={ex.origin.dropSegments} />
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-muted-foreground">Drop on</span>
                  <select value={ex.dropScope ?? ""} disabled={ex.dropSegments === 0} onChange={(e) => edit({ dropScope: (e.target.value || null) as DraftValues["dropScope"] })}
                    className={cn("h-9 rounded-sm border border-input bg-card px-1 text-[13px]", ex.dropSegments > 0 && !ex.dropScope && "border-negative/70")}>
                    <option value="">—</option>
                    <option value="last_set">Last set</option>
                    <option value="all_sets">Every set</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-muted-foreground">Tempo</span>
                  <Input value={ex.tempo ?? ""} maxLength={20} onChange={(e) => edit({ tempo: e.target.value.trim() ? e.target.value : null })} className="h-9 px-2 text-center text-[13px]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-medium text-muted-foreground">Superset</span>
                  <select value={ex.supersetGroup ?? ""} onChange={(e) => edit({ supersetGroup: e.target.value || null })} className="h-9 rounded-sm border border-input bg-card px-1 text-[13px]">
                    <option value="">—</option>
                    {"ABCDEFGH".split("").map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-muted-foreground">
                <label className="flex items-center gap-2">Reps per side <Switch checked={ex.perSide} onCheckedChange={(c) => edit({ perSide: c })} /></label>
                <label className="flex items-center gap-2">Optional <Switch checked={ex.optional} onCheckedChange={(c) => edit({ optional: c })} /></label>
              </div>
              <Textarea value={ex.notes ?? ""} maxLength={1000} onChange={(e) => edit({ notes: e.target.value || null })} placeholder="Notes" className="min-h-[56px] text-[13px]" />
              {ex.original.length > 0 && (
                <div className="rounded-md border bg-card px-3 py-2 text-[12.5px]">
                  <p className="mb-1 font-medium text-muted-foreground">Original · {ex.source.label}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {ex.original.map((o, i) => (
                      <div key={i} className="contents"><dt className="text-muted-foreground">{o.label}</dt><dd className="whitespace-pre-wrap break-words">{o.text}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}
          {problems.length > 0 && openFlags.length === 0 && (
            <ul className="text-[12.5px] text-negative">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

function summaryBits(ex: DraftExercise, unit: WeightUnit): string[] {
  const b: string[] = [];
  if (ex.loadKg != null) b.push(`${kgToDisplay(ex.loadKg, unit)} ${unit}`);
  if (ex.warmupSets) b.push(`${ex.warmupSets} warm-up`);
  if (ex.dropSegments) b.push(`${ex.dropSegments} drop${ex.dropSegments > 1 ? "s" : ""}${ex.dropScope === "all_sets" ? " every set" : ex.dropScope === "last_set" ? " last set" : ""}`);
  if (ex.tempo) b.push(`tempo ${ex.tempo}`);
  if (ex.supersetGroup) b.push(`superset ${ex.supersetGroup}`);
  if (ex.notes) b.push("notes");
  return b;
}

export function keyOf(c: ExerciseChoice) {
  return c.kind === "library" ? `l:${c.id}` : `c:${c.slug}`;
}
function sameChoice(a: ExerciseChoice, b: ExerciseChoice) {
  return keyOf(a) === keyOf(b);
}
