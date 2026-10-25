import type { ExerciseConfig, LoggedSet } from "./types";

export function isValidWorkingSet(s: LoggedSet): boolean {
  return s.kind === "working" && s.completed && s.reps != null && s.reps > 0;
}

export function workingSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter(isValidWorkingSet);
}

/**
 * Effective "difficulty load" used for comparisons, in kg.
 * - external / weighted bodyweight: the logged (added) weight
 * - bodyweight: added weight, 0 if none
 * - assisted: negative assistance (less assistance = harder)
 */
export function effectiveLoad(s: LoggedSet, ex: Pick<ExerciseConfig, "loadType">): number {
  if (ex.loadType === "assisted") return -(s.assistanceKg ?? 0);
  return s.weightKg ?? 0;
}

/** The load used for most working sets (ties → heavier). */
export function dominantLoad(sets: LoggedSet[], ex: Pick<ExerciseConfig, "loadType">): number | null {
  const ws = workingSets(sets);
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
