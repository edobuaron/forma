import type { WeightUnit } from "./types";

export const KG_PER_LB = 0.45359237;

export function kgToDisplay(kg: number, unit: WeightUnit): number {
  if (unit === "kg") return round(kg, 2);
  return round(kg / KG_PER_LB, 1);
}

export function displayToKg(value: number, unit: WeightUnit): number {
  if (unit === "kg") return round(value, 2);
  return round(value * KG_PER_LB, 3);
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** "62.5 kg", "137.5 lb". Drops trailing zeros. */
export function formatWeight(kg: number | null | undefined, unit: WeightUnit, withUnit = true): string {
  if (kg == null || Number.isNaN(kg)) return "—";
  const v = kgToDisplay(kg, unit);
  return withUnit ? `${v} ${unit}` : String(v);
}

/** Large totals: "12,450 kg". */
export function formatVolume(kg: number, unit: WeightUnit): string {
  return `${Math.round(kgToDisplay(kg, unit)).toLocaleString("en-US")} ${unit}`;
}

export function formatSigned(n: number, suffix = ""): string {
  const v = Number.isInteger(n) ? String(n) : String(round(n, 2));
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${v.replace("-", "")}${suffix}`;
}
