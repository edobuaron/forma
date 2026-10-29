import type { SetRow } from "@/lib/data/set-rows";
import type { ExerciseRow, PrescribedJson, SessionExerciseRow } from "@/lib/data/types";

export type WSet = SetRow;
export type { SideField, SidePatch } from "@/lib/data/set-rows";

export interface WExercise extends Pick<SessionExerciseRow, "track_sides" | "attachment_state" | "attachment_id" | "attachment_name"> {
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
