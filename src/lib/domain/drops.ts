import { hasLoggedLoad } from "./sets";
import { isSided, setPerformed, setVolumeKg, sideAsSet, SIDES } from "./sides";
import type { ExerciseConfig, LoggedSet } from "./types";

/**
 * Warm-up and drop-set rules.
 *
 * Warm-ups (kind "warmup")
 * - Never count toward planned-set completion, working-set volume, comparisons, progression or records.
 *   Every one of those reads kind "working" only. Warm-up work is reported on its own, if at all.
 *
 * Drop sets
 * - A drop set is a parent working set followed by ordered drop segments (kind "drop"). Each segment
 *   has its own load, reps, optional RIR and completion. Loads are whatever the user typed: no fixed
 *   percentage, no suggested weight.
 * - The sequence is ONE planned set: the parent is the working set; segments are counted separately.
 * - Drop work is part of TOTAL volume only, reported as its own line next to working volume. Working
 *   volume never contains it, so nothing is counted twice.
 * - Segments are never compared with straight sets, never satisfy straight-set progression and never
 *   create records: comparisons, progression and records read kind "working" only.
 * - Left/right: a segment of a sided parent has its own left and right values. Neither side is ever
 *   copied or completed automatically.
 * - Rest: no rest timer between segments. Normal rest starts once the sequence is finished.
 */

export const isDropSegment = (s: Pick<LoggedSet, "kind">) => s.kind === "drop";

/** A completed segment with reps and a logged load, the only kind counted in drop volume. */
export function isValidDropSegment(s: LoggedSet, ex: Pick<ExerciseConfig, "loadType">): boolean {
  return s.kind === "drop" && s.completed && s.reps != null && s.reps > 0 && hasLoggedLoad(s, ex);
}

/** Load × reps of a completed drop segment (external load only). Sides recorded separately add up. */
export function dropVolumeKg(s: LoggedSet, ex: Pick<ExerciseConfig, "loadType">): number {
  if (s.kind !== "drop") return 0;
  const parts = isSided(s) ? SIDES.map((side) => sideAsSet(s, side)) : [s];
  return parts.filter((p) => isValidDropSegment(p, ex)).reduce((a, p) => a + Math.max(0, p.weightKg ?? 0) * p.reps!, 0);
}

export interface VolumeBreakdown {
  /** Working sets only (drop parents included, their segments not). */
  workingKg: number;
  /** Completed drop segments. */
  dropKg: number;
  /** working + drop. Warm-ups are never included. */
  totalKg: number;
}

export function volumeBreakdown(sets: LoggedSet[], ex: Pick<ExerciseConfig, "loadType">): VolumeBreakdown {
  let workingKg = 0;
  let dropKg = 0;
  for (const s of sets) {
    if (s.kind === "working") workingKg += setVolumeKg(s, ex);
    else if (s.kind === "drop") dropKg += dropVolumeKg(s, ex);
  }
  return { workingKg, dropKg, totalKg: workingKg + dropKg };
}

/** Drop segments with recorded work (one side is enough). */
export function dropSegmentsDone(sets: LoggedSet[]): number {
  return sets.filter((s) => s.kind === "drop" && setPerformed(s)).length;
}

/** Warm-up sets marked done. */
export function warmupsDone(sets: LoggedSet[]): number {
  return sets.filter((s) => s.kind === "warmup" && s.completed).length;
}
