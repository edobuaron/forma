// Exercise substitutions: suggesting alternatives and planning what moves to the replacement.
// Pure functions, no I/O. Suggestions only use metadata the library actually records (primary and
// secondary muscles, equipment, category, load type and, for catalog exercises, the catalog group).
// They never imply that loads carry over between exercises.

export interface SubstituteCandidate {
  id: string;
  name: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: string;
  category: string;
  load_type: string;
  archived_at?: string | null;
  /** Catalog group ("chest", "back", …) when the exercise came from the catalog; null otherwise. */
  group?: string | null;
}

export interface Suggestion<T extends SubstituteCandidate> {
  exercise: T;
  score: number;
  /** Primary muscles both exercises train. */
  shared: string[];
  /** Short, factual reasons such as "Same muscles" or "Different equipment". */
  reasons: string[];
}

/**
 * Library exercises that train the same primary muscles, best first. An exercise qualifies only if it
 * shares at least one primary muscle with the original: equipment or category alone is never enough.
 * A different piece of equipment ranks a little higher, since a swap usually means the equipment is taken.
 */
export function suggestSubstitutes<T extends SubstituteCandidate>(original: SubstituteCandidate, library: T[], opts: { exclude?: string[]; limit?: number } = {}): Suggestion<T>[] {
  const exclude = new Set([original.id, ...(opts.exclude ?? [])]);
  const prim = new Set(original.primary_muscles);
  if (prim.size === 0) return [];
  const out: Suggestion<T>[] = [];
  for (const e of library) {
    if (exclude.has(e.id) || e.archived_at) continue;
    const shared = e.primary_muscles.filter((m) => prim.has(m));
    if (shared.length === 0) continue;
    const union = new Set([...e.primary_muscles, ...original.primary_muscles]).size;
    let score = (shared.length / union) * 10;
    const reasons: string[] = [];
    const allPrimary = shared.length === prim.size && e.primary_muscles.length === prim.size;
    reasons.push(allPrimary ? "Same primary muscles" : "Shares primary muscles");
    const secShared = e.secondary_muscles.filter((m) => original.secondary_muscles.includes(m)).length;
    score += Math.min(2, secShared * 0.5);
    if (original.group && e.group && original.group === e.group) score += 1.5;
    if (e.category === original.category) { score += 2; reasons.push(categoryReason(e.category)); }
    if (e.load_type === original.load_type) score += 1;
    if (e.equipment !== original.equipment) { score += 1; reasons.push(`Uses ${equipmentLabel(e.equipment)}`); }
    else reasons.push(`Also ${equipmentLabel(e.equipment)}`);
    out.push({ exercise: e, score: Math.round(score * 100) / 100, shared, reasons });
  }
  out.sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name));
  return out.slice(0, opts.limit ?? 6);
}

function categoryReason(c: string): string {
  if (c === "compound") return "Also a compound lift";
  if (c === "isolation") return "Also an isolation exercise";
  if (c === "skill") return "Also a skill";
  return "Same type";
}

export function equipmentLabel(e: string): string {
  return ({ barbell: "a barbell", dumbbell: "dumbbells", cable: "a cable", machine: "a machine", smith: "a Smith machine", bodyweight: "bodyweight", other: "other equipment" } as Record<string, string>)[e] ?? e;
}

// ---------- what moves to the replacement ----------

export interface SwapSet {
  id: string;
  kind: "warmup" | "working" | "drop";
  drop_parent_id?: string | null;
  sided?: boolean;
}

export interface SwapPlan<T extends SwapSet> {
  /** Sets that stay with the original exercise: everything with logged work, and the drops of those sets. */
  keep: T[];
  /** Sets not yet performed, which the replacement takes over (as new, empty sets). */
  move: T[];
  /** Working sets among `move`: the replacement's planned sets for today. */
  movedWorking: number;
  /** True when some work is already logged, so the original stays in the workout with it. */
  hasLogged: boolean;
}

/**
 * Splits an exercise's sets for a swap. A set with any logged work (one side is enough) stays with the
 * original exercise, together with its drop segments, so completed work is never relabelled. Only sets
 * with nothing performed move. Warm-ups not yet done move too; done ones stay.
 */
export function planSwap<T extends SwapSet>(sets: T[], performed: (s: T) => boolean): SwapPlan<T> {
  const keepIds = new Set<string>();
  for (const s of sets) if (performed(s)) keepIds.add(s.id);
  // A performed drop keeps its parent; a performed parent keeps its drops.
  for (const s of sets) {
    if (s.kind !== "drop" || !s.drop_parent_id) continue;
    if (keepIds.has(s.id)) keepIds.add(s.drop_parent_id);
  }
  for (const s of sets) if (s.kind === "drop" && s.drop_parent_id && keepIds.has(s.drop_parent_id)) keepIds.add(s.id);
  const keep = sets.filter((s) => keepIds.has(s.id));
  const move = sets.filter((s) => !keepIds.has(s.id));
  return { keep, move, movedWorking: move.filter((s) => s.kind === "working").length, hasLogged: keep.length > 0 };
}

/** The replacement's proposed targets: the original's sets, reps and rest, never its load. */
export interface ProposedTargets {
  sets: number;
  rep_min: number;
  rep_max: number;
  rest_s: number;
}

export function proposeTargets(
  prescribed: { sets?: number; rep_min?: number; rep_max?: number; rest_s?: number },
  replacement: { default_sets: number; default_rep_min: number; default_rep_max: number; default_rest_s: number },
  remainingWorking: number | null,
): ProposedTargets {
  const sets = remainingWorking ?? prescribed.sets ?? replacement.default_sets;
  return {
    sets: Math.max(1, sets),
    rep_min: prescribed.rep_min ?? replacement.default_rep_min,
    rep_max: prescribed.rep_max ?? replacement.default_rep_max,
    rest_s: prescribed.rest_s ?? replacement.default_rest_s,
  };
}
