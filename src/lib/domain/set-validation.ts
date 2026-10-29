import type { LoadType, Side } from "./types";

export interface SetValues {
  reps: number | null;
  weight_kg: number | null;
  assistance_kg: number | null;
}

/** Required values for active set logging and completion; explicit zero assistance is valid. */
export function setProblem(s: SetValues, loadType: LoadType): string | null {
  if (s.reps == null || !Number.isInteger(s.reps) || s.reps < 1 || s.reps > 200) return "Enter reps as a whole number from 1 to 200.";
  if (loadType === "assisted" && (s.assistance_kg == null || !Number.isFinite(Number(s.assistance_kg)) || Number(s.assistance_kg) < 0 || Number(s.assistance_kg) > 300)) return "Enter assistance from 0 to 300 kg (0 if none).";
  if (loadType === "external" && (s.weight_kg == null || !Number.isFinite(Number(s.weight_kg)) || Number(s.weight_kg) < 0 || Number(s.weight_kg) > 1000)) return "Enter a weight from 0 to 1000 kg.";
  return null;
}

export function reconcileCompletion<T extends SetValues & { completed: boolean; completed_at: string | null }>(s: T, loadType: LoadType): T {
  return s.completed && setProblem(s, loadType) ? { ...s, completed: false, completed_at: null } : s;
}

/** Per-side columns of a set row (migration 011). */
export interface SideColumns {
  sided: boolean;
  left_weight_kg: number | null; left_assistance_kg: number | null; left_reps: number | null; left_rir: number | null;
  left_completed: boolean; left_completed_at: string | null;
  right_weight_kg: number | null; right_assistance_kg: number | null; right_reps: number | null; right_rir: number | null;
  right_completed: boolean; right_completed_at: string | null;
}

export function sideValues(s: SideColumns, side: Side): SetValues {
  return { reps: s[`${side}_reps`], weight_kg: s[`${side}_weight_kg`], assistance_kg: s[`${side}_assistance_kg`] };
}

/**
 * A sided row after an edit: a performed side that no longer has valid values goes back to not
 * performed (the other side is untouched), and the row counts as completed while any side is.
 */
export function reconcileSides<T extends SideColumns & { completed: boolean; completed_at: string | null }>(s: T, loadType: LoadType): T {
  if (!s.sided) return s;
  const next = { ...s };
  for (const side of ["left", "right"] as const) {
    if (next[`${side}_completed`] && setProblem(sideValues(next, side), loadType)) {
      next[`${side}_completed`] = false;
      next[`${side}_completed_at`] = null;
    }
  }
  next.completed = next.left_completed || next.right_completed;
  if (!next.completed) next.completed_at = null;
  else if (!next.completed_at) next.completed_at = next.left_completed_at ?? next.right_completed_at;
  return next;
}
