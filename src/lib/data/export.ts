// CSV export of logged sets. Pure: takes rows already read through RLS.
type Row = Record<string, unknown>;

export const SET_CSV_COLUMNS = [
  "date", "workout", "exercise", "set_number", "side", "kind", "weight_kg", "assistance_kg", "reps", "rir", "bodyweight_kg",
  "equipment", "attachment", "load_type", "prescribed_rep_min", "prescribed_rep_max", "workout_id", "exercise_id", "set_id",
];

/**
 * One row per performed set of a completed workout. A set whose sides were recorded separately becomes
 * one row per performed side (same set_number and set_id, side = left/right); a side that wasn't
 * performed has no row and is never written as zero. Sets logged together have an empty side.
 * attachment: the name logged with the workout, "none" for no attachment, empty when not recorded.
 */
export function exportSetRows(hist: Row[], exById: Map<string, Row>): Row[] {
  return hist.filter((h) => h.status === "completed" && h.completed).flatMap((h) => {
    const e = exById.get(h.exercise_id as string) ?? {};
    const base = {
      date: h.started_at, workout: h.session_name, workout_id: h.session_id, exercise: e.name, exercise_id: h.exercise_id,
      equipment: e.equipment, load_type: e.load_type, set_number: (h.position as number) + 1, kind: h.kind, bodyweight_kg: h.bodyweight_kg,
      attachment: h.attachment_state === "attachment" ? h.attachment_name : h.attachment_state === "none" ? "none" : "",
      prescribed_rep_min: (h.prescribed as { rep_min?: number })?.rep_min, prescribed_rep_max: (h.prescribed as { rep_max?: number })?.rep_max,
      set_id: h.id,
    };
    if (!h.sided) return [{ ...base, side: "", weight_kg: h.weight_kg, assistance_kg: h.assistance_kg, reps: h.reps, rir: h.rir }];
    return (["left", "right"] as const).filter((s) => h[`${s}_completed`]).map((s) => ({
      ...base, side: s, weight_kg: h[`${s}_weight_kg`], assistance_kg: h[`${s}_assistance_kg`], reps: h[`${s}_reps`], rir: h[`${s}_rir`],
    }));
  });
}
