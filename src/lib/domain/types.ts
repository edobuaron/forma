// Pure domain types. No I/O, no framework imports — reusable by any client (web, native, API).

export type ExerciseCategory = "compound" | "isolation" | "bodyweight" | "weighted_bodyweight" | "skill";
export type LoadType = "external" | "bodyweight" | "weighted_bodyweight" | "assisted";
export type ProgressionStrategy = "double_progression" | "reps_first" | "bodyweight_reps" | "skill" | "none";
export type Equipment = "barbell" | "dumbbell" | "cable" | "machine" | "smith" | "bodyweight" | "other";
export type SetKind = "warmup" | "working";
/** Why planned sets were left out of a session. Recorded by the user; null means unknown. */
export type ShortfallReason = "time" | "equipment" | "fatigue" | "other";
export type WeightUnit = "kg" | "lb";

export interface ExerciseConfig {
  id: string;
  name: string;
  category: ExerciseCategory;
  loadType: LoadType;
  progression: ProgressionStrategy;
  incrementKg: number;
  minLoadKg: number;
  availableLoadsKg: number[] | null;
  e1rmEligible: boolean;
}

export interface Prescription {
  sets: number;
  repMin: number;
  repMax: number;
  restS: number;
  targetRir: number | null;
}

export type Side = "left" | "right";

/** One side of a set whose sides were recorded separately. A side not performed has completed = false. */
export interface SideLog {
  weightKg: number | null;
  assistanceKg: number | null;
  reps: number | null;
  rir: number | null;
  completed: boolean;
}

export interface LoggedSet {
  kind: SetKind;
  weightKg: number | null;
  assistanceKg: number | null;
  reps: number | null;
  rir: number | null;
  /** For a set with sides: at least one side was performed. */
  completed: boolean;
  /**
   * Present only when left and right were recorded independently. The set's own load, reps and RIR
   * are then null. Sets logged with one shared value (including "per side" / "per dumbbell" weights)
   * never have this.
   */
  sides?: Record<Side, SideLog> | null;
}

/** Which cable attachment a workout recorded. state null = not recorded (unknown), "none" = no attachment. */
export interface AttachmentRef {
  state: "none" | "attachment" | null;
  id: string | null;
  /** Name as it was when chosen for that workout. */
  name: string | null;
}

/** One exercise's performance within one completed session. */
export interface ExercisePerformance {
  sessionId: string;
  date: string; // ISO timestamp
  sets: LoggedSet[];
  prescription: Prescription | null;
  bodyweightKg?: number | null;
  /** Session-level reason for omitted planned sets. Only meaningful for exercises short of their prescription. */
  shortfallReason?: ShortfallReason | null;
  /** Attachment recorded for this exercise in that session. Absent = not recorded. */
  attachment?: AttachmentRef | null;
}
