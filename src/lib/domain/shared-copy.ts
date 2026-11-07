// Saving a shared workout's plan into your own programs. Pure.
//
// The source is the post's `plan`: the prescription the author's workout started from, written by the
// server. It never contains performed loads, reps, completion, RIR results, records or notes, and
// nothing here derives a prescription from performance. Fields the plan doesn't have stay empty for
// the recipient to fill; a prescribed load is kept only if the recipient explicitly chooses to.
import type { CatalogExercise } from "@/lib/catalog/catalog";
import { matchExercise, type LibraryEntry } from "@/lib/plan-import/match";
import type { ExerciseChoice, ExerciseMatch } from "@/lib/plan-import/types";

export type PlanItem = {
  name: string;
  catalog_slug?: string;
  equipment?: string;
  load_type?: string;
  muscles?: string[];
  /** False for an exercise added during the workout: there is no prescription for it. */
  planned?: boolean;
  sets?: number; rep_min?: number; rep_max?: number; rest_s?: number;
  target_rir?: number; target_rpe?: number; tempo?: string; per_side?: boolean;
  warmup_sets?: number; drop_segments?: number; drop_scope?: "last_set" | "all_sets"; superset_group?: string; optional?: boolean;
  /** Present only when the author shared loads and the plan prescribed one. */
  target_weight_kg?: number; convention?: string;
};

export type Resolution = ExerciseChoice | { kind: "new"; name: string };

export type CopyRow = {
  key: string;
  source: PlanItem;
  include: boolean;
  sets: number | null; repMin: number | null; repMax: number | null; restS: number | null;
  targetRir: number | null; targetRpe: number | null; tempo: string | null; perSide: boolean;
  warmupSets: number; dropSegments: number; dropScope: "last_set" | "all_sets" | null;
  supersetGroup: string | null; optional: boolean;
  /** The author's prescribed load (kg), shown as such; saved only when keepLoad is on. */
  prescribedLoadKg: number | null;
  keepLoad: boolean;
  match: ExerciseMatch;
  /** What the copy will use. Null until the recipient confirms or creates one. */
  resolution: Resolution | null;
};

export type CopyDraft = {
  requestId: string;
  workoutName: string;
  destination: { kind: "new"; name: string } | { kind: "existing"; programId: string };
  rows: CopyRow[];
};

/** The prescription fields a saved workout needs, and whether the plan supplied them. */
export const REQUIRED_FIELDS = ["sets", "repMin", "repMax", "restS"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Resolve one planned exercise against the recipient's own library and the built-in catalog. */
export function resolveExercise(item: PlanItem, library: LibraryEntry[], catalog: readonly CatalogExercise[]): { match: ExerciseMatch; resolution: Resolution | null } {
  if (item.catalog_slug) {
    const own = library.find((l) => l.catalogSlug === item.catalog_slug && !l.archived);
    if (own) {
      const choice = { kind: "library" as const, id: own.id, name: own.name };
      return { match: { status: "confirmed", choice, candidates: [{ choice, quality: "exact" }] }, resolution: choice };
    }
    const cat = catalog.find((c) => c.slug === item.catalog_slug);
    if (cat) {
      const byName = matchExercise(item.name, library, catalog);
      if (byName.status === "confirmed" && byName.choice?.kind === "library") return { match: byName, resolution: byName.choice };
      const choice = { kind: "catalog" as const, slug: cat.slug, name: cat.name };
      return { match: { status: "confirmed", choice, candidates: [{ choice, quality: "exact" }, ...byName.candidates.filter((c) => c.choice.kind === "library")] }, resolution: choice };
    }
  }
  const match = matchExercise(item.name, library, catalog);
  return { match, resolution: match.status === "confirmed" ? match.choice : null };
}

export function buildCopyDraft(input: {
  requestId: string; plan: PlanItem[]; workoutName: string; authorName: string;
  library: LibraryEntry[]; catalog: readonly CatalogExercise[];
}): CopyDraft {
  return {
    requestId: input.requestId,
    workoutName: input.workoutName.slice(0, 120),
    destination: { kind: "new", name: `${input.workoutName} (from ${input.authorName.split(" ")[0]})`.slice(0, 120) },
    rows: input.plan.map((p, i) => {
      const { match, resolution } = resolveExercise(p, input.library, input.catalog);
      return {
        key: `r${i}`,
        source: p,
        include: true,
        sets: num(p.sets), repMin: num(p.rep_min), repMax: num(p.rep_max), restS: num(p.rest_s),
        targetRir: num(p.target_rir), targetRpe: num(p.target_rpe), tempo: p.tempo ?? null, perSide: !!p.per_side,
        warmupSets: num(p.warmup_sets) ?? 0, dropSegments: num(p.drop_segments) ?? 0,
        dropScope: (num(p.drop_segments) ?? 0) > 0 ? (p.drop_scope ?? "last_set") : null,
        supersetGroup: p.superset_group && /^[A-Z]$/.test(p.superset_group) ? p.superset_group : null,
        optional: !!p.optional,
        prescribedLoadKg: num(p.target_weight_kg),
        keepLoad: false,
        match, resolution,
      };
    }),
  };
}

/** Which required fields the author's plan didn't supply for this row. */
export function missingFromPlan(row: CopyRow): RequiredField[] {
  const src = row.source;
  const had: Record<RequiredField, unknown> = { sets: src.sets, repMin: src.rep_min, repMax: src.rep_max, restS: src.rest_s };
  return REQUIRED_FIELDS.filter((f) => num(had[f]) == null);
}

/** True when the plan has every required field for every exercise, so nothing has to be filled in. */
export function planIsComplete(plan: PlanItem[]): boolean {
  return plan.length > 0 && plan.every((p) => p.planned !== false && [p.sets, p.rep_min, p.rep_max, p.rest_s].every((v) => num(v) != null));
}

const int = (n: number | null, lo: number, hi: number) => n != null && Number.isInteger(n) && n >= lo && n <= hi;

export function rowProblems(r: CopyRow): string[] {
  if (!r.include) return [];
  const p: string[] = [];
  if (!r.resolution) p.push(r.match.status === "proposed" ? "Confirm the exercise." : "Choose or create the exercise.");
  if (r.resolution?.kind === "new" && !r.resolution.name.trim()) p.push("Name the new exercise.");
  if (!int(r.sets, 1, 20)) p.push("Add sets (1–20).");
  if (!int(r.repMin, 1, 100) || !int(r.repMax, 1, 100) || (r.repMin ?? 0) > (r.repMax ?? 0)) p.push("Add a rep target (1–100, minimum no higher than maximum).");
  if (!int(r.restS, 0, 1800)) p.push("Add rest (0–30 min).");
  if (r.targetRir != null && !(r.targetRir >= 0 && r.targetRir <= 10)) p.push("RIR must be 0–10.");
  if (r.targetRpe != null && !(r.targetRpe >= 1 && r.targetRpe <= 10)) p.push("RPE must be 1–10.");
  return p;
}

export function draftProblems(d: CopyDraft): string[] {
  const out: string[] = [];
  if (!d.workoutName.trim()) out.push("Name the workout.");
  if (d.destination.kind === "new" && !d.destination.name.trim()) out.push("Name the new program.");
  const live = d.rows.filter((r) => r.include);
  if (live.length === 0) out.push("Keep at least one exercise.");
  if (live.length > 40) out.push("A workout can have up to 40 exercises.");
  return out;
}

export function canSave(d: CopyDraft): boolean {
  return draftProblems(d).length === 0 && d.rows.every((r) => rowProblems(r).length === 0);
}

/** What save_shared_workout() receives. Only prescription fields; a load only when explicitly kept. */
export function toSavePayload(d: CopyDraft) {
  return {
    destination: d.destination.kind === "new" ? { kind: "new", name: d.destination.name.trim() } : { kind: "existing", program_id: d.destination.programId },
    workout_name: d.workoutName.trim(),
    exercises: d.rows.filter((r) => r.include).map((r) => {
      const res = r.resolution!;
      const ref = res.kind === "library" ? { exercise_id: res.id }
        : res.kind === "catalog" ? { catalog_slug: res.slug }
        : { new: { name: res.name.trim(), equipment: r.source.equipment ?? null, load_type: r.source.load_type ?? null, muscles: r.source.muscles ?? [] } };
      return {
        ...ref,
        sets: r.sets, rep_min: r.repMin, rep_max: r.repMax, rest_s: r.restS,
        target_rir: r.targetRir, target_rpe: r.targetRpe, tempo: r.tempo, per_side: r.perSide,
        warmup_sets: r.warmupSets, drop_segments: r.dropSegments, drop_scope: r.dropSegments > 0 ? r.dropScope : null,
        superset_group: r.supersetGroup, optional: r.optional,
        target_weight_kg: r.keepLoad && r.prescribedLoadKg != null ? r.prescribedLoadKg : null,
      };
    }),
  };
}

const SAVE_ERRORS: Record<string, string> = {
  not_found: "This post isn't available any more.",
  not_saveable: "The author didn't share this workout's plan.",
  rate_limited: "You've saved many workouts today. Try again tomorrow.",
  invalid_workout_name: "Name the workout (up to 120 characters).",
  invalid_program_name: "Name the program (up to 120 characters).",
  invalid_destination: "Choose one of your programs, or a new one.",
  invalid_exercises: "Keep between 1 and 40 exercises.",
  unknown_exercise: "One of the exercises isn't in your library any more. Choose it again.",
  invalid_exercise_name: "Name the new exercise.",
  invalid_prescription: "Check sets, reps and rest for every exercise.",
  invalid: "This can't be saved.",
};
export function saveError(code: string): string {
  return SAVE_ERRORS[code] ?? "Not saved. Check your connection and try again.";
}

/** Short description of a planned exercise's extras, e.g. "2 warm-up sets · drop set on the last set · superset A". */
export function planExtras(r: Pick<CopyRow, "warmupSets" | "dropSegments" | "dropScope" | "supersetGroup" | "tempo" | "perSide" | "optional" | "targetRir" | "targetRpe">): string[] {
  const out: string[] = [];
  if (r.warmupSets > 0) out.push(`${r.warmupSets} warm-up ${r.warmupSets === 1 ? "set" : "sets"}`);
  if (r.dropSegments > 0) out.push(`${r.dropSegments === 1 ? "drop set" : `${r.dropSegments} drops`} ${r.dropScope === "all_sets" ? "on every set" : "on the last set"}`);
  if (r.supersetGroup) out.push(`superset ${r.supersetGroup}`);
  if (r.targetRir != null) out.push(`RIR ${r.targetRir}`);
  if (r.targetRpe != null) out.push(`RPE ${r.targetRpe}`);
  if (r.tempo) out.push(`tempo ${r.tempo}`);
  if (r.perSide) out.push("each side");
  if (r.optional) out.push("optional");
  return out;
}

const CONVENTION_LABEL: Record<string, string> = {
  total: "total", per_dumbbell: "per dumbbell", per_side: "per side", stack: "on the stack", added: "added", assistance: "assistance",
};

/** "70 kg total" — a prescribed load, labelled with what the number means. */
export function prescribedLoadLabel(kg: number, convention: string | undefined, fmt: (kg: number) => string): string {
  const c = convention ? CONVENTION_LABEL[convention] : null;
  return c ? `${fmt(kg)} ${c}` : fmt(kg);
}

function restLabel(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** One line for a planned exercise: "3 × 6–8 · rest 3 min", with "?" for anything the plan doesn't say. */
export function planLine(p: Pick<PlanItem, "sets" | "rep_min" | "rep_max" | "rest_s" | "planned">): string {
  if (p.planned === false) return "Added during the workout · no plan";
  const sets = num(p.sets), lo = num(p.rep_min), hi = num(p.rep_max), rest = num(p.rest_s);
  const reps = lo != null && hi != null ? (lo === hi ? `${lo}` : `${lo}–${hi}`) : "?";
  return [`${sets ?? "?"} × ${reps}`, rest != null ? `rest ${restLabel(rest)}` : null].filter(Boolean).join(" · ");
}
