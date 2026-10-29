// Editing a past workout: the editable fields, their validation, and the payload for save_session_edit.
import { format } from "date-fns";
import type { ShortfallReason } from "@/lib/domain/types";
import { sideValues, type SideColumns } from "@/lib/domain/set-validation";
import type { SessionFull } from "./queries";
import { normalizeSet } from "./set-rows";

/** As the server stores a sided set: a side not done keeps no values. */
function clearUndoneSides<T extends SideColumns>(s: T): T {
  if (!s.sided) return s;
  const out = { ...s };
  for (const k of ["left", "right"] as const) {
    if (out[`${k}_completed`]) continue;
    out[`${k}_weight_kg`] = null; out[`${k}_assistance_kg`] = null; out[`${k}_reps`] = null; out[`${k}_rir`] = null; out[`${k}_completed_at`] = null;
  }
  return out;
}

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
    items: s.exercises.map((e) => ({ ...e, track_sides: !!e.track_sides, sets: e.sets.map(normalizeSet) })),
    shortfallReason: s.shortfall_reason ?? null,
  };
}

/** The first problem that stops the draft from saving, or null. The server repeats the set checks. */
export function validateDraft(d: SessionDraft): string | null {
  for (const e of d.items) for (const s of e.sets) {
    const parts = s.sided
      ? (["left", "right"] as const).filter((side) => s[`${side}_completed`]).map((side) => ({ label: `${side} side`, v: sideValues(s, side) }))
      : [{ label: "set", v: s }];
    if (s.sided && parts.length === 0) return `${e.exercise.name}: a set tracked by side needs at least one side done. Remove the set if neither was.`;
    for (const { label, v } of parts) {
      if (v.reps == null || v.reps < 1 || !Number.isInteger(v.reps)) return `${e.exercise.name}: every ${label} needs reps (whole number ≥ 1).`;
      if (e.exercise.load_type === "external" && v.weight_kg == null) return `${e.exercise.name}: enter a weight for every ${label}.`;
      if (e.exercise.load_type === "assisted" && v.assistance_kg == null) return `${e.exercise.name}: enter the assistance for every ${label} (0 if none).`;
    }
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
    track_sides: boolean; attachment_state: EditExercise["attachment_state"]; attachment_id: string | null;
    sets: (Pick<EditExercise["sets"][number], "id" | "kind" | "weight_kg" | "assistance_kg" | "reps" | "rir" | "completed_at" | "notes"> & Partial<SideColumns>)[];
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
      track_sides: e.track_sides, attachment_state: e.attachment_state, attachment_id: e.attachment_id,
      sets: e.sets.map((s) => {
        const base = { id: s.id, kind: s.kind, completed_at: s.completed_at, notes: s.notes };
        if (!s.sided) return { ...base, weight_kg: s.weight_kg, assistance_kg: s.assistance_kg, reps: s.reps, rir: s.rir };
        // A side not done is sent without values: the server stores it as not performed, never as zero.
        const side = (k: "left" | "right") => (s[`${k}_completed`] ? {
          [`${k}_completed`]: true, [`${k}_weight_kg`]: s[`${k}_weight_kg`], [`${k}_assistance_kg`]: s[`${k}_assistance_kg`],
          [`${k}_reps`]: s[`${k}_reps`], [`${k}_rir`]: s[`${k}_rir`], [`${k}_completed_at`]: s[`${k}_completed_at`],
        } : { [`${k}_completed`]: false });
        return { ...base, weight_kg: null, assistance_kg: null, reps: null, rir: null, sided: true, ...side("left"), ...side("right") };
      }),
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
      sets: e.sets.map((s, j) => clearUndoneSides({ ...s, position: j, completed: true, completed_at: s.completed_at ?? startedAt })),
    })),
  };
}
