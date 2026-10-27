import type { ShortfallReason } from "./types";

export const SHORTFALL_REASONS: ShortfallReason[] = ["time", "equipment", "fatigue", "other"];

export const shortfallLabel: Record<ShortfallReason, string> = {
  time: "Ran out of time",
  equipment: "Equipment unavailable",
  fatigue: "Fatigue / couldn't finish",
  other: "Other",
};

/**
 * Whether an exercise ended with fewer working sets than planned. Optional exercises and
 * exercises without a planned set count never count as short.
 */
export function isShortOfPlan(prescribed: { sets?: number; optional?: boolean }, completedWorkingSets: number): boolean {
  return !prescribed.optional && prescribed.sets != null && completedWorkingSets < prescribed.sets;
}
