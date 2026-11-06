// Turns a shared workout snapshot into short, readable lines for the feed. Only reads what the
// snapshot holds, so it can never show more than the author chose to share.
import type { WeightUnit } from "./types";
import { kgToDisplay } from "./units";

export type Side = { kg?: number; assist_kg?: number; reps?: number };
export type SnapSet = Side & { left?: Side; right?: Side };
export type SnapExercise = { name: string; convention?: string; sets: SnapSet[] };

function load(s: Side, unit: WeightUnit): string | null {
  if (s.assist_kg != null) return `−${kgToDisplay(s.assist_kg, unit)}`;
  if (s.kg != null) return `${kgToDisplay(s.kg, unit)}`;
  return null;
}

function one(s: Side, unit: WeightUnit): string {
  const l = load(s, unit), r = s.reps;
  if (l != null && r != null) return `${l}×${r}`;
  if (l != null) return l;
  if (r != null) return `${r}`;
  return "✓";
}

/**
 * "3 × 8 · 80 kg" when every set matches, otherwise the sets in order ("80×8, 80×7, 75×6 kg").
 * Left/right sets read "L 20×10 · R 20×9". Sets only, when loads and reps were hidden.
 */
export function exerciseLine(sets: SnapSet[], unit: WeightUnit): string {
  if (sets.length === 0) return "";
  const sided = sets.some((s) => s.left || s.right);
  const hasLoad = sets.some((s) => s.kg != null || s.assist_kg != null || s.left?.kg != null || s.right?.kg != null || s.left?.assist_kg != null || s.right?.assist_kg != null);
  const hasReps = sets.some((s) => s.reps != null || s.left?.reps != null || s.right?.reps != null);
  const n = sets.length;
  const count = `${n} ${n === 1 ? "set" : "sets"}`;
  if (!hasLoad && !hasReps) return count;
  if (sided) {
    return sets.map((s) => [s.left ? `L ${one(s.left, unit)}` : null, s.right ? `R ${one(s.right, unit)}` : null].filter(Boolean).join(" · ")).join(", ");
  }
  const first = sets[0];
  const same = sets.every((s) => s.kg === first.kg && s.assist_kg === first.assist_kg && s.reps === first.reps);
  if (same) {
    const l = load(first, unit);
    const reps = first.reps != null ? `${n} × ${first.reps}` : count;
    return l != null ? `${reps} · ${l} ${unit}` : reps;
  }
  const body = sets.map((s) => one(s, unit)).join(", ");
  return hasLoad ? `${body} ${unit}` : `${body} reps`;
}

export function workingSetCount(ex: SnapExercise[]): number {
  return ex.reduce((n, e) => n + e.sets.length, 0);
}

/**
 * Total load × reps in kg, only when loads and reps were shared and every exercise logs its load as a
 * plain total (per-dumbbell, per-side or assisted loads would make a single number misleading).
 */
export function shareVolumeKg(ex: SnapExercise[]): number | null {
  let total = 0, any = false;
  for (const e of ex) {
    if (e.convention && e.convention !== "total") return null;
    for (const s of e.sets) {
      for (const side of s.left || s.right ? [s.left, s.right] : [s]) {
        if (!side) continue;
        if (side.assist_kg != null) return null;
        if (side.kg != null && side.reps != null) { total += side.kg * side.reps; any = true; }
      }
    }
  }
  return any ? total : null;
}
