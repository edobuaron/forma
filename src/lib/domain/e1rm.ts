import type { ExerciseConfig, LoggedSet } from "./types";

export const E1RM_FORMULA = "Epley";
export const E1RM_MAX_REPS = 12;

/** Epley estimate: w × (1 + reps / 30). Only meaningful for 1–12 reps. */
export function epley(weightKg: number, reps: number): number | null {
  if (!(weightKg > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** Estimated 1RM for a set, or null when the estimate would be misleading. */
export function setE1rm(set: LoggedSet, ex: Pick<ExerciseConfig, "e1rmEligible" | "loadType">): number | null {
  if (!ex.e1rmEligible || ex.loadType !== "external") return null;
  if (!set.completed || set.kind !== "working" || set.weightKg == null || set.reps == null) return null;
  return epley(set.weightKg, set.reps);
}
