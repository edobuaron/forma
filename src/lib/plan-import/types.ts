// Workout-plan import: the draft the user reviews before a program is created. Pure types and limits.
//
// Pipeline: source (paste, CSV, XLSX, or a document read by an AI provider) → SourceRows (each field's
// text exactly as written, plus where it came from) → interpretRow() → DraftExercise (values, flags,
// exercise match) → review → validateDraft() → create_program_from_import() on the server.
// The numbers in a plan are prescriptions. Nothing here represents performed work.

export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_XLSX_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 600;
export const MAX_WORKOUTS = 30;
export const MAX_EXERCISES_PER_WORKOUT = 40;

export type SourceKind = "paste" | "csv" | "xlsx" | "pdf" | "image" | "manual";

/** Fields a plan row can carry. "setsReps" is a combined cell such as "3×8–10". */
export type PlanField =
  | "workout" | "order" | "exercise" | "setsReps" | "sets" | "reps" | "rest" | "load" | "rir" | "rpe" | "effort"
  | "tempo" | "notes";

export const FIELD_LABELS: Record<PlanField, string> = {
  workout: "Workout / day",
  order: "Order (A1, B2…)",
  exercise: "Exercise",
  setsReps: "Sets × reps",
  sets: "Sets",
  reps: "Reps",
  rest: "Rest",
  load: "Load",
  rir: "RIR",
  rpe: "RPE",
  effort: "Effort (RIR or RPE?)",
  tempo: "Tempo",
  notes: "Notes",
};

/** Where a value came from, so the user can check it against the original. */
export interface SourceRef {
  /** "Sheet1!B4", "Row 4", "Line 12", "Page 2". */
  label: string;
  /** The whole original row or line, as written. */
  text: string;
}

/** One row of the plan as written: field → original text. */
export interface SourceRow {
  ref: SourceRef;
  workout?: string;
  cells: Partial<Record<PlanField, string>>;
  /** Header (or field label) each cell came from, for showing the original wording. */
  headers?: Partial<Record<PlanField, string>>;
  /** Exercise name expanded by an AI reader ("DB RDL" → "Dumbbell Romanian deadlift"). Matching only. */
  nameSuggestion?: string;
  /** Unit stated by a column header ("Rest (min)", "Load (lb)"). */
  restUnit?: "s" | "min";
  loadUnit?: "kg" | "lb";
}

export type FlagField =
  | "exercise" | "sets" | "reps" | "rest" | "load" | "effort" | "tempo" | "warmup" | "drop" | "superset" | "notes" | "row";

/** A one-click resolution. `patch` is applied to the exercise and the flag is resolved. */
export interface FlagOption {
  label: string;
  patch: Partial<DraftValues>;
}

export interface Flag {
  id: string;
  field: FlagField;
  /** Stable machine code; tests and the UI key on it. */
  code:
    | "ambiguous_reps" | "missing_sets" | "missing_reps" | "time_based" | "amrap" | "rest_unit" | "rest_range"
    | "effort_unclear" | "effort_range" | "load_unit" | "load_percent" | "load_unparsed" | "drop_count" | "drop_scope"
    | "superset_unclear" | "warmup_count" | "unsupported" | "unparsed" | "exercise_unmatched" | "exercise_proposed" | "per_side";
  message: string;
  /** Blocking flags must be resolved (an option chosen or the field edited) before import. */
  blocking: boolean;
  options?: FlagOption[];
  resolved?: boolean;
}

export type Origin = "extracted" | "interpreted" | "edited" | "default";

export type ExerciseChoice =
  | { kind: "library"; id: string; name: string }
  | { kind: "catalog"; slug: string; name: string };

export interface MatchCandidate {
  choice: ExerciseChoice;
  /** exact = same name or alias; expanded = same after expanding abbreviations; similar = shares words. */
  quality: "exact" | "expanded" | "similar";
}

export interface ExerciseMatch {
  /** confirmed = will be used; proposed = needs the user's confirmation; none = choose or create. */
  status: "confirmed" | "proposed" | "none";
  choice: ExerciseChoice | null;
  candidates: MatchCandidate[];
}

/** The prescription values a user can edit. Units: seconds and kilograms. */
export interface DraftValues {
  sets: number | null;
  repMin: number | null;
  repMax: number | null;
  restS: number | null;
  loadKg: number | null;
  targetRir: number | null;
  targetRpe: number | null;
  tempo: string | null;
  perSide: boolean;
  warmupSets: number;
  dropSegments: number;
  dropScope: "last_set" | "all_sets" | null;
  supersetGroup: string | null;
  optional: boolean;
  notes: string | null;
}

export interface DraftExercise extends DraftValues {
  id: string;
  source: SourceRef;
  /** Original wording per field (header → text), never edited. */
  original: { label: string; text: string }[];
  /** The exercise name as written (editable; the original stays in `original`). */
  name: string;
  match: ExerciseMatch;
  origin: Partial<Record<keyof DraftValues | "name", Origin>>;
  flags: Flag[];
  /** Excluded rows stay in the draft (visible, struck through) but aren't imported. */
  skipped?: boolean;
}

export interface DraftWorkout {
  id: string;
  name: string;
  source: SourceRef | null;
  /** General warm-up instructions for the workout ("5 min bike"), kept as the workout's warm-up notes. */
  warmupNotes: string | null;
  exercises: DraftExercise[];
}

/** How grid columns map to fields; kept so the user can change the mapping and re-run extraction. */
export interface GridSource {
  sheets: { name: string; rows: string[][] }[];
  sheet: number;
  headerRow: number | null;
  mapping: (PlanField | null)[];
}

export interface PlanDraft {
  version: 1;
  /** Client-generated; also the idempotency key for creating the program. */
  importId: string;
  programName: string;
  sourceKind: SourceKind;
  sourceName: string | null;
  workouts: DraftWorkout[];
  /** Plan-level text that isn't a prescription (titles, general instructions), kept for review. */
  notes: string[];
  /** File-level problems (e.g. several week columns). */
  notices: string[];
  grid?: GridSource;
  /** Pasted text, kept so a different reading can be tried without pasting again. */
  text?: string;
}

export const EMPTY_VALUES: DraftValues = {
  sets: null, repMin: null, repMax: null, restS: null, loadKg: null, targetRir: null, targetRpe: null, tempo: null,
  perSide: false, warmupSets: 0, dropSegments: 0, dropScope: null, supersetGroup: null, optional: false, notes: null,
};
