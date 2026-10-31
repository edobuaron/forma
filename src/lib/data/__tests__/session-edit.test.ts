import { describe, expect, it } from "vitest";
import { draftFromSession, savedDraft, toSessionEdit, validateDraft } from "../session-edit";
import type { SessionFull } from "../queries";
import { emptySideColumns, type ExerciseRow, type SetLogRow } from "../types";

const exercise = (load_type: ExerciseRow["load_type"], name: string) => ({ id: `ex-${name}`, name, load_type }) as ExerciseRow;
const set = (o: Partial<SetLogRow>): SetLogRow => ({
  id: "set1", session_id: "s1", session_exercise_id: "se1", position: 0, kind: "working",
  weight_kg: null, assistance_kg: null, reps: 5, rir: null, completed: true, completed_at: null, notes: null,
  ...emptySideColumns(), ...o,
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

describe("history editor with sides", () => {
  const sidedSet = (o: Partial<SetLogRow>) => set({
    reps: null, sided: true, left_weight_kg: 25, left_reps: 10, left_completed: true, right_weight_kg: 25, right_reps: 7, right_completed: false, ...o,
  });
  const ex = exercise("external", "Single-arm row");

  it("sends a side that wasn't done without values, so it's stored as not performed", () => {
    const edit = toSessionEdit(draftFromSession(session([sidedSet({})], ex)));
    const s = edit.exercises[0].sets[0];
    expect(s).toMatchObject({ sided: true, left_completed: true, left_weight_kg: 25, left_reps: 10, right_completed: false });
    expect(s).not.toHaveProperty("right_reps");
  });

  it("requires at least one done side, and reps and load on each done side", () => {
    expect(validateDraft(draftFromSession(session([sidedSet({ left_completed: false })], ex)))).toMatch(/at least one side/);
    expect(validateDraft(draftFromSession(session([sidedSet({ left_weight_kg: null })], ex)))).toMatch(/weight for every left side/);
    expect(validateDraft(draftFromSession(session([sidedSet({})], ex)))).toBeNull();
  });

  it("keeps the exercise's mode and attachment in the payload", () => {
    const s = session([sidedSet({})], ex);
    Object.assign(s.exercises[0], { track_sides: true, attachment_state: "none", attachment_id: null });
    expect(toSessionEdit(draftFromSession(s)).exercises[0]).toMatchObject({ track_sides: true, attachment_state: "none", attachment_id: null });
  });
});

describe("history editor: warm-ups and drops", () => {
  const row = exercise("external", "Lateral raise");
  const sets = [
    set({ id: "w", position: 0, kind: "warmup", weight_kg: 5, reps: 15 }),
    set({ id: "d1", position: 3, kind: "drop", drop_parent_id: "a", weight_kg: 7.5, reps: 8 }),
    set({ id: "a", position: 1, weight_kg: 10, reps: 12 }),
    set({ id: "b", position: 2, weight_kg: 10, reps: 11 }),
  ];

  it("loads drops right after their parent, and sends the parent only for drops", () => {
    const d = draftFromSession(session(sets, row));
    expect(d.items[0].sets.map((s) => s.id)).toEqual(["w", "a", "d1", "b"]);
    const out = toSessionEdit(d).exercises[0].sets;
    expect(out.map((s) => [s.id, s.kind, s.drop_parent_id])).toEqual([["w", "warmup", undefined], ["a", "working", undefined], ["d1", "drop", "a"], ["b", "working", undefined]]);
    expect(validateDraft(d)).toBeNull();
  });

  it("refuses a drop that doesn't follow a working set of its exercise", () => {
    const d = draftFromSession(session(sets, row));
    d.items[0].sets = [d.items[0].sets[2], ...d.items[0].sets.filter((s) => s.id !== "d1")];
    expect(validateDraft(d)).toMatch(/drop must follow its working set/);
  });
});
