import type { ExerciseConfig, LoggedSet } from "./types";

type LoadInfo = Pick<ExerciseConfig, "loadType">;

/**
 * Whether the set records the load it was done with. A missing value is never read as zero:
 * assisted sets need an explicit assistance value (0 is valid) and external sets a weight.
 * Bodyweight movements need nothing, since no added weight means bodyweight only.
 */
export function hasLoggedLoad(s: LoggedSet, ex: LoadInfo): boolean {
  if (ex.loadType === "assisted") return s.assistanceKg != null;
  if (ex.loadType === "external") return s.weightKg != null;
  return true;
}

/** Completed working sets with reps, in order, whether or not a load was logged. Used only to pair sets by position. */
export function completedWorkingSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter((s) => s.kind === "working" && s.completed && s.reps != null && s.reps > 0);
}

/** A completed working set with reps and a logged load: the only kind used for comparisons, records and analytics. */
export function isValidWorkingSet(s: LoggedSet, ex: LoadInfo): boolean {
  return s.kind === "working" && s.completed && s.reps != null && s.reps > 0 && hasLoggedLoad(s, ex);
}

export function workingSets(sets: LoggedSet[], ex: LoadInfo): LoggedSet[] {
  return sets.filter((s) => isValidWorkingSet(s, ex));
}

/**
 * Effective "difficulty load" used for comparisons, in kg.
 * - external / weighted bodyweight: the logged (added) weight
 * - bodyweight: added weight, 0 if none
 * - assisted: negative assistance (less assistance = harder)
 */
export function effectiveLoad(s: LoggedSet, ex: LoadInfo): number {
  if (ex.loadType === "assisted") return -(s.assistanceKg ?? 0);
  return s.weightKg ?? 0;
}

/** The load used for most working sets (ties → heavier). */
export function dominantLoad(sets: LoggedSet[], ex: LoadInfo): number | null {
  const ws = workingSets(sets, ex);
  if (ws.length === 0) return null;
  const counts = new Map<number, number>();
  for (const s of ws) {
    const l = effectiveLoad(s, ex);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [l, c] of counts) {
    if (c > bestCount || (c === bestCount && best != null && l > best)) {
      best = l;
      bestCount = c;
    }
  }
  return best;
}

export const sameLoad = (a: number, b: number) => Math.abs(a - b) < 0.01;
