import { describe, expect, it } from "vitest";
import { draftFromSession, savedDraft, toSessionEdit, validateDraft } from "../session-edit";
import type { SessionFull } from "../queries";
import type { ExerciseRow, SetLogRow } from "../types";

const exercise = (load_type: ExerciseRow["load_type"], name: string) => ({ id: `ex-${name}`, name, load_type }) as ExerciseRow;
const set = (o: Partial<SetLogRow>): SetLogRow => ({
  id: "set1", session_id: "s1", session_exercise_id: "se1", position: 0, kind: "working",
  weight_kg: null, assistance_kg: null, reps: 5, rir: null, completed: true, completed_at: null, notes: null, ...o,
});
const session = (sets: SetLogRow[], ex = exercise("assisted", "Assisted Dip")): SessionFull => ({
  id: "s1", name: "Upper", notes: null, status: "completed",
  started_at: "2026-10-20T16:00:00.000Z", ended_at: "2026-10-20T17:15:00.000Z",
  exercises: [{ id: "se1", session_id: "s1", exercise_id: ex.id, template_exercise_id: null, substituted_for: null, position: 0, prescribed: {}, notes: null, exercise: ex, sets }],
}) as unknown as SessionFull;

describe("history editor validation", () => {
  it("requires assistance on assisted sets, accepting an explicit zero", () => {
    expect(validateDraft(draftFromSession(session([set({ assistance_kg: null })])))).toMatch(/Assisted Dip: enter the assistance/);
    expect(validateDraft(draftFromSession(session([set({ assistance_kg: 0 })])))).toBeNull();
  });

  it("still requires weight on external sets and reps everywhere", () => {
    expect(validateDraft(draftFromSession(session([set({ weight_kg: null })], exercise("external", "Row"))))).toMatch(/Row: enter a weight/);
    expect(validateDraft(draftFromSession(session([set({ weight_kg: 0, reps: null })], exercise("external", "Row"))))).toMatch(/reps/);
  });
});

describe("history editor draft", () => {
  it("covers every editable field, including start time and duration", () => {
    const d = draftFromSession(session([set({ assistance_kg: 10 })]));
    expect(d).toMatchObject({ name: "Upper", notes: "", minutes: 75 });
    expect(new Date(d.start).toISOString()).toBe("2026-10-20T16:00:00.000Z");
    expect(d.items).toHaveLength(1);
  });

  it("sends explicit zero assistance and the edited times", () => {
    const d = { ...draftFromSession(session([set({ assistance_kg: 0 })])), minutes: 50 };
    const edit = toSessionEdit(d);
    expect(edit.exercises[0].sets[0].assistance_kg).toBe(0);
    expect(new Date(edit.session.ended_at).getTime() - new Date(edit.session.started_at).getTime()).toBe(50 * 60000);
  });

  it("becomes the new baseline after a save", () => {
    const d = { ...draftFromSession(session([set({ assistance_kg: 5 })])), name: "  Upper B ", minutes: 40 };
    const next = savedDraft(d);
    expect(next).toMatchObject({ name: "Upper B", minutes: 40, start: d.start });
    expect(next.items[0].sets[0]).toMatchObject({ completed: true, completed_at: new Date(d.start).toISOString() });
  });

  it("carries the shortened-workout reason so it can be corrected in History", () => {
    const d = draftFromSession({ ...session([set({ assistance_kg: 0 })]), shortfall_reason: "time" } as SessionFull);
    expect(d.shortfallReason).toBe("time");
    expect(toSessionEdit({ ...d, shortfallReason: "equipment" }).session.shortfall_reason).toBe("equipment");
    expect(toSessionEdit({ ...d, shortfallReason: null }).session.shortfall_reason).toBeNull();
  });
});
