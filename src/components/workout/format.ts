import type { SetComparison } from "@/lib/domain/comparison";
import type { LoadType, LoggedSet, WeightUnit } from "@/lib/domain/types";
import { formatWeight, kgToDisplay } from "@/lib/domain/units";

export function loadColumnLabel(loadType: LoadType, unit: WeightUnit) {
  if (loadType === "assisted") return `Assist`;
  if (loadType === "bodyweight" || loadType === "weighted_bodyweight") return `+${unit}`;
  return unit;
}

/** Compact "60 × 10", "BW × 8", "+15 × 5", "−10 × 3" (assisted). */
export function formatSetShort(s: LoggedSet, loadType: LoadType, unit: WeightUnit): string {
  const reps = s.reps ?? "–";
  if (loadType === "assisted") return `${s.assistanceKg ? kgToDisplay(s.assistanceKg, unit) : 0} × ${reps}`;
  if (loadType === "bodyweight" || loadType === "weighted_bodyweight") {
    return s.weightKg ? `+${kgToDisplay(s.weightKg, unit)} × ${reps}` : `BW × ${reps}`;
  }
  return `${s.weightKg != null ? kgToDisplay(s.weightKg, unit) : "–"} × ${reps}`;
}

/** "55 kg × 9, 10, 10" — groups consecutive sets at the same load. */
export function formatSetsCompact(sets: LoggedSet[], loadType: LoadType, unit: WeightUnit): string {
  const groups: { label: string; reps: (number | string)[] }[] = [];
  for (const s of sets) {
    const label = formatSetLong(s, loadType, unit).replace(/ × [^×]*$/, "");
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.reps.push(s.reps ?? "–");
    else groups.push({ label, reps: [s.reps ?? "–"] });
  }
  return groups.map((g) => `${g.label} × ${g.reps.join(", ")}`).join(" · ");
}

export function formatSetLong(s: LoggedSet, loadType: LoadType, unit: WeightUnit): string {
  if (loadType === "assisted") return `${formatWeight(s.assistanceKg ?? 0, unit)} assist × ${s.reps}`;
  if (loadType === "bodyweight" || loadType === "weighted_bodyweight") {
    return s.weightKg ? `+${formatWeight(s.weightKg, unit)} × ${s.reps}` : `Bodyweight × ${s.reps}`;
  }
  return `${formatWeight(s.weightKg, unit)} × ${s.reps}`;
}

export function comparisonText(c: SetComparison, unit: WeightUnit, loadType: LoadType): { text: string; tone: "positive" | "negative" | "neutral" } | null {
  const reps = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)} rep${Math.abs(n) === 1 ? "" : "s"}`;
  const load = (kg: number) => {
    const v = Math.abs(kgToDisplay(kg, unit));
    if (loadType === "assisted") return kg > 0 ? `−${v} ${unit} assist` : `+${v} ${unit} assist`;
    return `${kg > 0 ? "+" : "−"}${v} ${unit}`;
  };
  switch (c.status) {
    case "no_previous":
      return null;
    case "matched":
      return c.basis === "e1rm" ? { text: "Similar strength (est.)", tone: "neutral" } : { text: "Matched", tone: "neutral" };
    case "not_comparable":
      return { text: `${c.loadDeltaKg > 0 ? (loadType === "assisted" ? "Less assistance" : "Heavier") : loadType === "assisted" ? "More assistance" : "Lighter"} · new baseline`, tone: "neutral" };
    case "improved":
    case "below": {
      const tone = c.status === "improved" ? "positive" : "negative";
      if (c.basis === "same_load") return { text: reps(c.repDelta), tone };
      if (c.basis === "same_reps") return { text: load(c.loadDeltaKg), tone };
      if (c.basis === "e1rm") return { text: "Stronger (est. 1RM)", tone };
      return { text: `${load(c.loadDeltaKg)}, ${reps(c.repDelta)}`, tone };
    }
  }
}
