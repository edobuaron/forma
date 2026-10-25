import type { ExerciseRow, PrescribedJson, SetLogRow } from "@/lib/data/types";

export type WSet = Omit<SetLogRow, "session_id" | "session_exercise_id">;

export interface WExercise {
  id: string;
  exercise: ExerciseRow;
  exercise_id: string;
  template_exercise_id: string | null;
  substituted_for: string | null;
  position: number;
  prescribed: PrescribedJson;
  notes: string | null;
  sets: WSet[];
}
