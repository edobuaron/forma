// Training categories for visual identity only: a small colour marker and label shared by the dashboard,
// workout cards, history and the exercise library. Never used for calculations.
export type Category = "push" | "pull" | "legs" | "core" | "mixed";

export const CATEGORY_LABEL: Record<Category, string> = { push: "Push", pull: "Pull", legs: "Legs", core: "Core", mixed: "Mixed" };

const MUSCLE_CATEGORY: Record<string, Exclude<Category, "mixed">> = {
  chest: "push", upper_chest: "push", front_delts: "push", side_delts: "push", triceps: "push",
  lats: "pull", upper_back: "pull", traps: "pull", rear_delts: "pull", biceps: "pull", forearms: "pull",
  glutes: "legs", quads: "legs", hamstrings: "legs", adductors: "legs", calves: "legs", spinal_erectors: "legs",
  abs: "core",
};

/** An exercise's category from its primary muscles; ties or unknown muscles are "mixed". */
export function exerciseCategory(primary: readonly string[] | null | undefined): Category {
  const count = new Map<Category, number>();
  for (const m of primary ?? []) { const c = MUSCLE_CATEGORY[m]; if (c) count.set(c, (count.get(c) ?? 0) + 1); }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return "mixed";
  return ranked[0][0];
}

const NAME_RULES: [RegExp, Category][] = [
  [/\b(push|chest|press)\b/i, "push"],
  [/\b(pull|back)\b/i, "pull"],
  [/\b(leg|legs|lower|squat|glute)/i, "legs"],
  [/\b(core|abs)\b/i, "core"],
];

/** A workout's category from its name ("Push", "Lower"…); "Upper", "Full body" and the like are "mixed". */
export function workoutCategory(name: string): Category {
  if (/\b(upper|full|total)\b/i.test(name)) return "mixed";
  for (const [re, c] of NAME_RULES) if (re.test(name)) return c;
  return "mixed";
}
