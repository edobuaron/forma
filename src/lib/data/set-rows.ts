// Row-level edits of logged sets, shared by the active workout and the history editor.
// Pure functions over set rows: no I/O, no React. The rules themselves live in src/lib/domain.
import { reconcileCompletion, reconcileSides, type SideColumns } from "@/lib/domain/set-validation";
import { setHasData } from "@/lib/domain/sides";
import type { LoadType, Side } from "@/lib/domain/types";
import { emptySideColumns, toLoggedSet, type PrescribedJson, type SetLogRow } from "./types";

export type SetRow = Omit<SetLogRow, "session_id" | "session_exercise_id">;
export type SideField = "weight_kg" | "assistance_kg" | "reps" | "rir";
export type SidePatch = Partial<Record<SideField, number | null>>;

const n = (v: unknown) => (v == null ? null : Number(v));

/** PostgREST returns numerics as strings; every numeric column becomes a number (or stays null). */
export function normalizeSet<T extends SetRow>(s: T): T {
  return {
    ...s,
    weight_kg: n(s.weight_kg), assistance_kg: n(s.assistance_kg), rir: n(s.rir),
    sided: !!s.sided,
    left_weight_kg: n(s.left_weight_kg), left_assistance_kg: n(s.left_assistance_kg), left_rir: n(s.left_rir),
    right_weight_kg: n(s.right_weight_kg), right_assistance_kg: n(s.right_assistance_kg), right_rir: n(s.right_rir),
    left_completed: !!s.left_completed, right_completed: !!s.right_completed,
    left_completed_at: s.left_completed_at ?? null, right_completed_at: s.right_completed_at ?? null,
    left_reps: s.left_reps ?? null, right_reps: s.right_reps ?? null,
  };
}

/** A new set in the given mode. Loads (never reps, RIR or completion) are carried over from `from` as a starting value. */
export function newSet(id: string, opts: { kind: SetRow["kind"]; sided: boolean; from?: SetRow | null }): SetRow {
  const f = opts.kind === "working" ? opts.from : null;
  const sides = emptySideColumns(opts.sided);
  if (opts.sided && f?.sided) {
    sides.left_weight_kg = f.left_weight_kg; sides.left_assistance_kg = f.left_assistance_kg;
    sides.right_weight_kg = f.right_weight_kg; sides.right_assistance_kg = f.right_assistance_kg;
  }
  return {
    id, position: 0, kind: opts.kind,
    weight_kg: opts.sided ? null : f && !f.sided ? f.weight_kg : null,
    assistance_kg: opts.sided ? null : f && !f.sided ? f.assistance_kg : null,
    reps: null, rir: null, completed: false, completed_at: null, notes: null, ...sides,
  };
}

/** Edit one side's values. A performed side that loses a required value goes back to not performed. */
export function patchSide<T extends SetRow>(s: T, side: Side, patch: SidePatch, loadType: LoadType): T {
  const next = { ...s } as T & SideColumns;
  for (const [k, v] of Object.entries(patch) as [SideField, number | null][]) (next as unknown as Record<string, unknown>)[`${side}_${k}`] = v;
  return reconcileSides(next, loadType);
}

/** Mark one side performed or not. The other side is never touched. */
export function setSideCompleted<T extends SetRow>(s: T, side: Side, completed: boolean, at: string | null, values: SidePatch = {}, loadType: LoadType = "external"): T {
  const next = patchSide(s, side, values, loadType) as T;
  const r = { ...next, [`${side}_completed`]: completed, [`${side}_completed_at`]: completed ? at : null } as T;
  return reconcileSides(r, loadType);
}

/**
 * The explicit "Copy left to right" shortcut: copies load, reps and RIR. It never marks the right
 * side as performed; that stays a separate tap.
 */
export function copyLeftToRight<T extends SetRow>(s: T, loadType: LoadType): T {
  return patchSide(s, "right", {
    weight_kg: s.left_weight_kg, assistance_kg: s.left_assistance_kg, reps: s.left_reps, rir: s.left_rir,
  }, loadType);
}

/**
 * Switch an exercise between logging together and logging sides. Only sets without any typed or
 * performed value change mode; sets holding data keep theirs, so nothing logged is ever discarded.
 */
export function switchMode<T extends SetRow>(sets: T[], sided: boolean): { sets: T[]; changed: T[]; kept: number } {
  const changed: T[] = [];
  let kept = 0;
  const out = sets.map((s) => {
    if (!!s.sided === sided) return s;
    if (setHasData(toLoggedSet(s))) { kept++; return s; }
    const next = { ...s, ...emptySideColumns(sided), weight_kg: null, assistance_kg: null, reps: null, rir: null, completed: false, completed_at: null };
    changed.push(next);
    return next;
  });
  return { sets: out, changed, kept };
}

export function reconcileSet<T extends SetRow>(s: T, loadType: LoadType): T {
  return s.sided ? reconcileSides(s, loadType) : reconcileCompletion(s, loadType);
}

/** Renumber positions in array order. Returns the rows whose position changed (they need saving). */
export function renumber<T extends SetRow>(sets: T[]): { sets: T[]; changed: T[] } {
  const changed: T[] = [];
  const out = sets.map((s, i) => {
    if (s.position === i) return s;
    const next = { ...s, position: i };
    changed.push(next);
    return next;
  });
  return { sets: out, changed };
}

export interface RemovedSet<T extends SetRow = SetRow> {
  set: T;
  index: number;
}

export function removeSet<T extends SetRow>(sets: T[], id: string): { sets: T[]; removed: RemovedSet<T> | null } {
  const index = sets.findIndex((s) => s.id === id);
  if (index < 0) return { sets, removed: null };
  return { sets: sets.filter((s) => s.id !== id), removed: { set: sets[index], index } };
}

/**
 * Undo a removal: the same row (same id, values, completion and sides) goes back where it was.
 * Positions are renumbered so the order is exactly as before. Safe to apply twice.
 */
export function restoreSet<T extends SetRow>(sets: T[], removed: RemovedSet<T>): { sets: T[]; changed: T[] } {
  if (sets.some((s) => s.id === removed.set.id)) return { sets, changed: [] };
  const arr = [...sets];
  arr.splice(Math.min(removed.index, arr.length), 0, removed.set);
  const r = renumber(arr);
  const restored = r.sets.find((s) => s.id === removed.set.id)!;
  return { sets: r.sets, changed: r.changed.some((s) => s.id === restored.id) ? r.changed : [restored, ...r.changed] };
}

/** Planned working sets: the prescription, or the working sets present when there is none. */
export function plannedSets(prescribed: PrescribedJson, sets: Pick<SetRow, "kind">[]): number {
  return prescribed.sets ?? sets.filter((s) => s.kind === "working").length;
}

/**
 * What removing this set means. An extra set beyond the plan is simply gone. Removing a planned set
 * leaves the plan unchanged: the set counts as not performed (never as done) when the workout ends.
 */
export function removalKind(prescribed: PrescribedJson, sets: SetRow[], id: string): "warmup" | "extra" | "planned" {
  const s = sets.find((x) => x.id === id);
  if (!s || s.kind === "warmup") return "warmup";
  const working = sets.filter((x) => x.kind === "working").length;
  return working > plannedSets(prescribed, sets) ? "extra" : "planned";
}
