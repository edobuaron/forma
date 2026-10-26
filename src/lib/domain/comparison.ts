import { epley } from "./e1rm";
import { completedWorkingSets, effectiveLoad, hasLoggedLoad, isValidWorkingSet, sameLoad } from "./sets";
import type { ExerciseConfig, LoggedSet } from "./types";

export type ComparisonStatus =
  | "improved" //  better by an unambiguous measure
  | "matched" //   same load, same reps
  | "below" //     worse by an unambiguous measure
  | "not_comparable" // load and reps moved in opposite directions and no valid estimate exists
  | "no_previous"; // nothing valid to compare with

export interface SetComparison {
  status: ComparisonStatus;
  loadDeltaKg: number; // in effective-load terms (assistance: positive = less assistance)
  repDelta: number;
  /** Only set when the verdict relied on an estimated 1RM. */
  e1rmDeltaKg?: number;
  basis: "same_load" | "same_reps" | "both_better" | "both_worse" | "e1rm" | "none";
}

const NONE: SetComparison = { status: "no_previous", loadDeltaKg: 0, repDelta: 0, basis: "none" };

/**
 * Compare a completed set with the corresponding previous set.
 * Conservative: when load and reps move in opposite directions we only give a verdict
 * if an estimated 1RM is appropriate for this exercise and both sets are within 1–12 reps;
 * otherwise we say the sets aren't directly comparable rather than guess.
 */
export function compareSet(
  current: LoggedSet,
  previous: LoggedSet | null | undefined,
  ex: Pick<ExerciseConfig, "loadType" | "e1rmEligible">,
): SetComparison {
  if (!previous || !isValidWorkingSet(previous, ex) || !isValidWorkingSet(current, ex)) return NONE;
  const cl = effectiveLoad(current, ex);
  const pl = effectiveLoad(previous, ex);
  const cr = current.reps!;
  const pr = previous.reps!;
  const loadDeltaKg = Math.round((cl - pl) * 100) / 100;
  const repDelta = cr - pr;

  if (sameLoad(cl, pl)) {
    return {
      status: repDelta > 0 ? "improved" : repDelta < 0 ? "below" : "matched",
      loadDeltaKg: 0,
      repDelta,
      basis: "same_load",
    };
  }
  if (repDelta === 0) {
    return { status: loadDeltaKg > 0 ? "improved" : "below", loadDeltaKg, repDelta, basis: "same_reps" };
  }
  if (loadDeltaKg > 0 && repDelta > 0) return { status: "improved", loadDeltaKg, repDelta, basis: "both_better" };
  if (loadDeltaKg < 0 && repDelta < 0) return { status: "below", loadDeltaKg, repDelta, basis: "both_worse" };

  // Opposite directions (e.g. heavier load, fewer reps — the normal result of a planned load increase).
  // Never call this "below": an estimated 1RM may only confirm an improvement or similar strength,
  // and only for lifts where the estimate is appropriate. Otherwise it's a new, not directly comparable baseline.
  if (ex.e1rmEligible && ex.loadType === "external") {
    const c = epley(cl, cr);
    const p = epley(pl, pr);
    if (c != null && p != null) {
      const d = c - p;
      const rel = d / p;
      if (rel > 0.02) return { status: "improved", loadDeltaKg, repDelta, e1rmDeltaKg: Math.round(d * 10) / 10, basis: "e1rm" };
      if (rel >= -0.02) return { status: "matched", loadDeltaKg, repDelta, e1rmDeltaKg: Math.round(d * 10) / 10, basis: "e1rm" };
    }
  }
  return { status: "not_comparable", loadDeltaKg, repDelta, basis: "none" };
}

/**
 * Pair the i-th working set of the current session with the i-th working set of the previous one.
 * Pairing is by position among completed working sets, so a set with no logged load leaves a gap
 * (no comparison) instead of shifting every later pair.
 */
export function previousCounterpart(previousSets: LoggedSet[], workingIndex: number, ex: Pick<ExerciseConfig, "loadType">): LoggedSet | null {
  const s = completedWorkingSets(previousSets)[workingIndex];
  return s && hasLoggedLoad(s, ex) ? s : null;
}

export interface PreviousSummary {
  completedWorkingSets: number;
  prescribedSets: number | null;
  incomplete: boolean;
}

export function summarisePrevious(previousSets: LoggedSet[], prescribedSets: number | null): PreviousSummary {
  const n = completedWorkingSets(previousSets).length;
  return {
    completedWorkingSets: n,
    prescribedSets,
    incomplete: prescribedSets != null && n < prescribedSets,
  };
}
