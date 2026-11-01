// Starting energy: an optional, self-reported 1–10 rating of how energetic the user felt when the
// workout started. It is not effort, RIR or workout difficulty, and nothing derives training
// recommendations from it. null = not answered.

export const ENERGY_MIN = 1;
export const ENERGY_MAX = 10;
export const ENERGY_LEVELS = Array.from({ length: ENERGY_MAX }, (_, i) => i + ENERGY_MIN);

const LABELS = [
  "Exhausted", "Drained", "Very tired", "Tired", "A bit flat",
  "Okay", "Good", "Energised", "Very energised", "Full of energy",
];

export function isEnergyRating(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= ENERGY_MIN && v <= ENERGY_MAX;
}

/** A short description of a rating. */
export function energyLabel(v: number): string {
  if (!isEnergyRating(v)) throw new RangeError(`energy rating out of range: ${v}`);
  return LABELS[v - ENERGY_MIN];
}

/** "7/10 · Good", or null when not answered. */
export function energySummary(v: number | null | undefined): string | null {
  return isEnergyRating(v) ? `${v}/10 · ${energyLabel(v)}` : null;
}

/** Position of a rating along the low → high scale, 0..1. */
export function energyPosition(v: number): number {
  return (v - ENERGY_MIN) / (ENERGY_MAX - ENERGY_MIN);
}
