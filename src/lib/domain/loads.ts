import type { ExerciseConfig } from "./types";
import { round } from "./units";

/**
 * Smallest load strictly above `currentKg` that is actually available for this exercise.
 * Uses the explicit available-load list when set, otherwise the increment grid.
 * Never invents a weight that cannot be loaded.
 */
export function nextAvailableLoad(
  currentKg: number,
  ex: Pick<ExerciseConfig, "incrementKg" | "minLoadKg" | "availableLoadsKg">,
): number | null {
  if (ex.availableLoadsKg && ex.availableLoadsKg.length > 0) {
    const above = [...ex.availableLoadsKg].sort((a, b) => a - b).find((l) => l > currentKg + 0.001);
    return above ?? null;
  }
  const inc = ex.incrementKg;
  if (!(inc > 0)) return null;
  const base = ex.minLoadKg ?? 0;
  const steps = Math.floor((currentKg - base) / inc + 1e-9) + 1;
  return round(Math.max(base, base + steps * inc), 3);
}

/** Largest available load strictly below `currentKg`. */
export function previousAvailableLoad(
  currentKg: number,
  ex: Pick<ExerciseConfig, "incrementKg" | "minLoadKg" | "availableLoadsKg">,
): number | null {
  if (ex.availableLoadsKg && ex.availableLoadsKg.length > 0) {
    const below = [...ex.availableLoadsKg].sort((a, b) => b - a).find((l) => l < currentKg - 0.001);
    return below ?? null;
  }
  const inc = ex.incrementKg;
  const base = ex.minLoadKg ?? 0;
  const steps = Math.ceil((currentKg - base) / inc - 1e-9) - 1;
  const v = round(base + steps * inc, 3);
  return v >= base && v < currentKg ? v : null;
}
