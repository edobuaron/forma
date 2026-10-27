// Editing a past workout: the editable fields, their validation, and the payload for save_session_edit.
import { format } from "date-fns";
import type { ShortfallReason } from "@/lib/domain/types";
import type { SessionFull } from "./queries";

export type EditExercise = SessionFull["exercises"][number];

/** Every editable field of a past workout. */
export interface SessionDraft {
  name: string;
  notes: string;
  start: string; // yyyy-MM-ddTHH:mm in local time, as used by <input type="datetime-local">
  minutes: number;
  items: EditExercise[];
  shortfallReason: ShortfallReason | null;
}

export function draftFromSession(s: SessionFull): SessionDraft {
  return {
    name: s.name,
    notes: s.notes ?? "",
    start: format(new Date(s.started_at), "yyyy-MM-dd'T'HH:mm"),
    minutes: s.ended_at ? Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000) : 60,
    items: s.exercises,
    shortfallReason: s.shortfall_reason ?? null,
  };
}

/** The first problem that stops the draft from saving, or null. The server repeats the set checks. */
export function validateDraft(d: SessionDraft): string | null {
  for (const e of d.items) for (const s of e.sets) {
    if (s.reps == null || s.reps < 1 || !Number.isInteger(s.reps)) return `${e.exercise.name}: every set needs reps (whole number ≥ 1).`;
    if (e.exercise.load_type === "external" && s.weight_kg == null) return `${e.exercise.name}: enter a weight for every set.`;
    if (e.exercise.load_type === "assisted" && s.assistance_kg == null) return `${e.exercise.name}: enter the assistance for every set (0 if none).`;
  }
  if (!d.name.trim()) return "Name the workout.";
  if (Number.isNaN(new Date(d.start).getTime())) return "Invalid date.";
  if (!(d.minutes >= 1 && d.minutes <= 600)) return "Duration must be 1–600 minutes.";
  return null;
}

export interface SessionEdit {
  session: { name: string; notes: string | null; started_at: string; ended_at: string; shortfall_reason: ShortfallReason | null };
  exercises: {
    id: string; exercise_id: string; prescribed: EditExercise["prescribed"]; notes: string | null;
    sets: Pick<EditExercise["sets"][number], "id" | "kind" | "weight_kg" | "assistance_kg" | "reps" | "rir" | "completed_at" | "notes">[];
  }[];
}

/** What save_session_edit receives. Array order becomes the saved position. */
export function toSessionEdit(d: SessionDraft): SessionEdit {
  const startedAt = new Date(d.start);
  return {
    session: {
      name: d.name.trim(), notes: d.notes || null, started_at: startedAt.toISOString(),
      ended_at: new Date(startedAt.getTime() + d.minutes * 60000).toISOString(),
      shortfall_reason: d.shortfallReason,
    },
    exercises: d.items.map((e) => ({
      id: e.id, exercise_id: e.exercise_id, prescribed: e.prescribed, notes: e.notes,
      sets: e.sets.map((s) => ({
        id: s.id, kind: s.kind, weight_kg: s.weight_kg, assistance_kg: s.assistance_kg, reps: s.reps, rir: s.rir,
        completed_at: s.completed_at, notes: s.notes,
      })),
    })),
  };
}

/** The draft as stored after a successful save, so later edits and Cancel start from it. */
export function savedDraft(d: SessionDraft): SessionDraft {
  const startedAt = new Date(d.start).toISOString();
  return {
    ...d,
    name: d.name.trim(),
    items: d.items.map((e, i) => ({
      ...e, position: i,
      sets: e.sets.map((s, j) => ({ ...s, position: j, completed: true, completed_at: s.completed_at ?? startedAt })),
    })),
  };
}
