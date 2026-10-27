// Rules that keep an exercise's load type, weight entry and progression consistent.
// Shared by the exercise form and the CSV import so both accept and refuse the same things.
import {
  defaultProgression, defaultWeightEntry,
  type CatalogCategory, type CatalogEquipment, type CatalogLoadType, type WeightEntry,
} from "./catalog";

export { defaultProgression, defaultWeightEntry };

export const WEIGHT_ENTRY_LABEL: Record<WeightEntry, string> = {
  total: "Total weight (bar included)",
  per_dumbbell: "Per dumbbell",
  per_side: "Per side",
  stack: "Stack / pin number",
  added: "Added weight (0 = bodyweight)",
  assistance: "Assistance",
};

export const WEIGHT_ENTRY_SHORT: Record<WeightEntry, string> = {
  total: "Total load",
  per_dumbbell: "Per dumbbell",
  per_side: "Per side",
  stack: "Stack",
  added: "Added weight",
  assistance: "Assistance",
};

export const LOAD_TYPE_LABEL: Record<CatalogLoadType, string> = {
  external: "Weights or machine",
  bodyweight: "Bodyweight",
  weighted_bodyweight: "Bodyweight + added weight",
  assisted: "Assisted (band or machine)",
};

export function defaultCategory(loadType: CatalogLoadType): CatalogCategory {
  if (loadType === "weighted_bodyweight") return "weighted_bodyweight";
  if (loadType === "bodyweight" || loadType === "assisted") return "bodyweight";
  return "isolation";
}

/** Why a combination is contradictory, or null when it is consistent. */
export function conventionProblem(x: {
  equipment: CatalogEquipment; loadType: CatalogLoadType; weightEntry: WeightEntry;
}): string | null {
  const { equipment, loadType, weightEntry } = x;
  if (loadType === "assisted" && weightEntry !== "assistance") return "Assisted exercises record the assistance (weight entry: assistance).";
  if (weightEntry === "assistance" && loadType !== "assisted") return "Weight entry 'assistance' needs load type 'assisted'.";
  if ((loadType === "bodyweight" || loadType === "weighted_bodyweight") && weightEntry !== "added")
    return "Bodyweight exercises record only added weight (weight entry: added).";
  if (weightEntry === "added" && loadType === "external") return "Weight entry 'added' needs a bodyweight load type.";
  if (weightEntry === "per_dumbbell" && equipment !== "dumbbell") return "Weight entry 'per dumbbell' needs dumbbell equipment.";
  return null;
}

/** Estimated 1RM is only offered for compound lifts with external load. */
export function e1rmAllowed(x: { loadType: CatalogLoadType; category: CatalogCategory }) {
  return x.loadType === "external" && x.category === "compound";
}
