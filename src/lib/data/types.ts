// Row types mirroring the Postgres schema (supabase/migrations). Keep in sync with migrations.
import type {
  Equipment, ExerciseCategory, ExerciseConfig, LoadType, LoggedSet, Prescription, ProgressionStrategy,
  SetKind, WeightUnit,
} from "@/lib/domain/types";

export interface ProfileRow {
  id: string;
  display_name: string | null;
  unit: WeightUnit;
  default_rest_s: number;
  auto_rest_timer: boolean;
  rest_sound: boolean;
  bodyweight_kg: number | null;
  progression_conservative: boolean;
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
  weight_convention: "total" | "per_side" | "per_dumbbell" | "stack" | "added";
  progression: ProgressionStrategy;
  e1rm_eligible: boolean;
  notes: string | null;
  instructions: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  version: number;
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
}

export interface SetLogRow {
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

export interface SetHistoryRow {
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

export function toLoggedSet(r: Pick<SetLogRow, "kind" | "weight_kg" | "assistance_kg" | "reps" | "rir" | "completed">): LoggedSet {
  return {
    kind: r.kind,
    weightKg: num(r.weight_kg),
    assistanceKg: num(r.assistance_kg),
    reps: r.reps,
    rir: num(r.rir),
    completed: r.completed,
  };
}
