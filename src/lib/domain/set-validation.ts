import type { LoadType } from "./types";

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
