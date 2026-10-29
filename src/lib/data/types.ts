// Row types mirroring the Postgres schema (supabase/migrations). Keep in sync with migrations.
import type {
  AttachmentRef, Equipment, ExerciseCategory, ExerciseConfig, LoadType, LoggedSet, Prescription, ProgressionStrategy,
  SetKind, ShortfallReason, WeightUnit,
} from "@/lib/domain/types";
import type { SideColumns } from "@/lib/domain/set-validation";

/** What the weight field means for an exercise. "assistance" added in migration 009. */
export type WeightConvention = "total" | "per_side" | "per_dumbbell" | "stack" | "added" | "assistance";

export interface ProfileRow {
  id: string;
  display_name: string | null;
  unit: WeightUnit;
  default_rest_s: number;
  auto_rest_timer: boolean;
  rest_sound: boolean;
  bodyweight_kg: number | null;
  progression_conservative: boolean;
  /** null until first-run setup is done. Added in migration 009. */
  onboarded_at: string | null;
  setup_choice: "empty" | "starter" | "legacy" | null;
  /** When this account's one automatic starter copy was made (migration 010). Never reset. */
  starter_seeded_at: string | null;
  starter_version: number | null;
  created_at: string;
}

export interface ExerciseRow {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: Equipment;
  category: ExerciseCategory;
  load_type: LoadType;
  default_sets: number;
  default_rep_min: number;
  default_rep_max: number;
  default_rest_s: number;
  increment_kg: number;
  min_load_kg: number;
  available_loads_kg: number[] | null;
  weight_convention: WeightConvention;
  progression: ProgressionStrategy;
  e1rm_eligible: boolean;
  notes: string | null;
  instructions: string | null;
  /** Catalog entry this exercise was copied from (migration 009). Never updated by catalog changes. */
  catalog_slug: string | null;
  catalog_version: number | null;
  aliases: string[];
  source: "custom" | "catalog" | "import";
  /** True while increment_kg is a generic default the user hasn't confirmed for their equipment. */
  increment_is_generic: boolean;
  /** Logging defaults copied into each new workout (migration 011). */
  track_sides: boolean;
  default_attachment_state: AttachmentState;
  default_attachment_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** null = not recorded, "none" = explicitly no attachment. */
export type AttachmentState = "none" | "attachment" | null;

export interface AttachmentRow {
  id: string;
  name: string;
  starter_key: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  version: number;
  /** Starter template version this program was copied from; null for programs the user made. */
  starter_version: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateRow {
  id: string;
  program_id: string;
  name: string;
  day_of_week: number | null;
  position: number;
  notes: string | null;
  warmup_notes: string | null;
}

export interface TemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  position: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  rest_s: number;
  target_rir: number | null;
  optional: boolean;
  notes: string | null;
}

export interface SessionRow {
  id: string;
  template_id: string | null;
  program_id: string | null;
  name: string;
  status: "in_progress" | "completed" | "discarded";
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  bodyweight_kg: number | null;
  /** Why planned sets were omitted; null = not recorded. Added in migration 008. */
  shortfall_reason: ShortfallReason | null;
  created_at?: string;
  updated_at?: string;
}

export interface PrescribedJson {
  sets?: number;
  rep_min?: number;
  rep_max?: number;
  rest_s?: number;
  target_rir?: number | null;
  optional?: boolean;
  notes?: string | null;
}

export interface SessionExerciseRow {
  id: string;
  session_id: string;
  exercise_id: string;
  template_exercise_id: string | null;
  substituted_for: string | null;
  position: number;
  prescribed: PrescribedJson;
  notes: string | null;
  /** Mode new sets start in for this workout (migration 011). */
  track_sides: boolean;
  attachment_state: AttachmentState;
  attachment_id: string | null;
  /** Snapshot taken by the server when the attachment was chosen; later renames don't change it. */
  attachment_name: string | null;
}

export interface SetLogRow extends SideColumns {
  id: string;
  session_id: string;
  session_exercise_id: string;
  position: number;
  kind: SetKind;
  weight_kg: number | null;
  assistance_kg: number | null;
  reps: number | null;
  rir: number | null;
  completed: boolean;
  completed_at: string | null;
  notes: string | null;
}

export interface SetHistoryRow extends Omit<SideColumns, "left_completed_at" | "right_completed_at"> {
  id: string;
  session_id: string;
  session_exercise_id: string;
  exercise_id: string;
  started_at: string;
  status: SessionRow["status"];
  session_name: string;
  bodyweight_kg: number | null;
  prescribed: PrescribedJson;
  se_position: number;
  position: number;
  kind: SetKind;
  weight_kg: number | null;
  assistance_kg: number | null;
  reps: number | null;
  rir: number | null;
  completed: boolean;
  completed_at: string | null;
  shortfall_reason: ShortfallReason | null;
  attachment_state: AttachmentState;
  attachment_id: string | null;
  attachment_name: string | null;
}

export interface PersonalRecordRow {
  id: string;
  exercise_id: string;
  session_id: string;
  type: string;
  value: number;
  load_kg: number | null;
  reps: number | null;
  previous: number | null;
  achieved_at: string;
  /** Records of sides recorded separately (migration 011); null for sets logged together. */
  side: "left" | "right" | null;
}

export interface BodyMeasurementRow {
  id: string;
  measured_on: string;
  bodyweight_kg: number | null;
  waist_cm: number | null;
  chest_cm: number | null;
  shoulders_cm: number | null;
  arms_cm: number | null;
  thighs_cm: number | null;
  hips_cm: number | null;
  notes: string | null;
}

// ---------- mappers to domain types ----------
const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function toExerciseConfig(r: ExerciseRow): ExerciseConfig {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    loadType: r.load_type,
    progression: r.progression,
    incrementKg: Number(r.increment_kg),
    minLoadKg: Number(r.min_load_kg ?? 0),
    availableLoadsKg: r.available_loads_kg?.map(Number) ?? null,
    e1rmEligible: r.e1rm_eligible,
  };
}

export function toPrescription(p: PrescribedJson | null | undefined, ex?: ExerciseRow): Prescription {
  return {
    sets: p?.sets ?? ex?.default_sets ?? 3,
    repMin: p?.rep_min ?? ex?.default_rep_min ?? 8,
    repMax: p?.rep_max ?? ex?.default_rep_max ?? 12,
    restS: p?.rest_s ?? ex?.default_rest_s ?? 90,
    targetRir: p?.target_rir ?? null,
  };
}

type LoggedSetSource = Pick<SetLogRow, "kind" | "weight_kg" | "assistance_kg" | "reps" | "rir" | "completed">
  & Partial<Omit<SideColumns, "left_completed_at" | "right_completed_at">>;

export function toLoggedSet(r: LoggedSetSource): LoggedSet {
  const side = (p: "left" | "right") => ({
    weightKg: num(r[`${p}_weight_kg`]),
    assistanceKg: num(r[`${p}_assistance_kg`]),
    reps: r[`${p}_reps`] ?? null,
    rir: num(r[`${p}_rir`]),
    completed: !!r[`${p}_completed`],
  });
  return {
    kind: r.kind,
    weightKg: num(r.weight_kg),
    assistanceKg: num(r.assistance_kg),
    reps: r.reps,
    rir: num(r.rir),
    completed: r.completed,
    sides: r.sided ? { left: side("left"), right: side("right") } : null,
  };
}

export function toAttachmentRef(r: { attachment_state?: AttachmentState; attachment_id?: string | null; attachment_name?: string | null }): AttachmentRef {
  return { state: r.attachment_state ?? null, id: r.attachment_id ?? null, name: r.attachment_name ?? null };
}

/** Empty side columns for a set row (logged together, or a new sided set before anything is typed). */
export function emptySideColumns(sided = false): SideColumns {
  return {
    sided,
    left_weight_kg: null, left_assistance_kg: null, left_reps: null, left_rir: null, left_completed: false, left_completed_at: null,
    right_weight_kg: null, right_assistance_kg: null, right_reps: null, right_rir: null, right_completed: false, right_completed_at: null,
  };
}

// ---------- history rows: counting and volume (rules in src/lib/domain/sides.ts) ----------
type CountRow = Pick<SetHistoryRow, "kind" | "weight_kg" | "reps" | "completed"> & Partial<Omit<SideColumns, "left_completed_at" | "right_completed_at">>;

/** A working row with recorded work: reps for a set logged together, any performed side for a pair. */
export function isWorkingRow(r: CountRow): boolean {
  if (r.kind !== "working" || !r.completed) return false;
  return r.sided ? !!(r.left_completed || r.right_completed) : (r.reps ?? 0) > 0;
}

/** Sets credited for counts: 1 per set, ½ for a pair with one side done. */
export function rowSetCredit(r: CountRow): number {
  if (!isWorkingRow(r)) return 0;
  return r.sided ? (Number(!!r.left_completed) + Number(!!r.right_completed)) / 2 : 1;
}

/** Load × reps; a pair adds each performed side's own work. Rows logged together are unchanged from before sides existed. */
export function rowVolumeKg(r: CountRow): number {
  if (!isWorkingRow(r)) return 0;
  if (!r.sided) return Math.max(0, Number(r.weight_kg ?? 0)) * (r.reps ?? 0);
  return (["left", "right"] as const).reduce((a, k) =>
    a + (r[`${k}_completed`] ? Math.max(0, Number(r[`${k}_weight_kg`] ?? 0)) * (r[`${k}_reps`] ?? 0) : 0), 0);
}

/** The logging context a new workout would start in for this exercise (its defaults). */
export function defaultContext(e: Pick<ExerciseRow, "track_sides" | "default_attachment_state" | "default_attachment_id">): { sides: boolean; attachment: AttachmentRef } {
  return { sides: e.track_sides, attachment: { state: e.default_attachment_state, id: e.default_attachment_id, name: null } };
}
