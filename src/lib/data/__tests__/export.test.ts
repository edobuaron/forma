import { describe, expect, it } from "vitest";
import { exportSetRows } from "../export";

const base = { status: "completed", completed: true, session_id: "s1", session_name: "Pull", started_at: "2026-10-29T10:00:00Z", exercise_id: "e1", kind: "working", prescribed: {} };
const ex = new Map([["e1", { name: "Single-arm row", equipment: "cable", load_type: "external" }]]);

describe("set CSV export", () => {
  it("keeps sets logged together as one row, unchanged", () => {
    const [r] = exportSetRows([{ ...base, id: "a", position: 0, sided: false, weight_kg: 60, reps: 10, rir: 1, attachment_state: null }], ex);
    expect(r).toMatchObject({ side: "", weight_kg: 60, reps: 10, rir: 1, set_number: 1, attachment: "" });
  });
  it("writes each performed side as its own row and leaves out a side that wasn't done", () => {
    const rows = exportSetRows([{
      ...base, id: "b", position: 1, sided: true, weight_kg: null, reps: null, attachment_state: "attachment", attachment_name: "Rope",
      left_completed: true, left_weight_kg: 25, left_reps: 10, left_rir: 2, right_completed: false, right_weight_kg: null, right_reps: null,
    }], ex);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ side: "left", weight_kg: 25, reps: 10, rir: 2, set_number: 2, set_id: "b", attachment: "Rope" });
  });
  it("unequal sides stay as recorded; 'No attachment' is distinct from not recorded", () => {
    const rows = exportSetRows([{
      ...base, id: "c", position: 0, sided: true, attachment_state: "none",
      left_completed: true, left_weight_kg: 25, left_reps: 10, right_completed: true, right_weight_kg: 22.5, right_reps: 8,
    }], ex);
    expect(rows.map((r) => [r.side, r.weight_kg, r.reps, r.attachment])).toEqual([["left", 25, 10, "none"], ["right", 22.5, 8, "none"]]);
  });
  it("skips incomplete sets and unfinished workouts", () => {
    expect(exportSetRows([{ ...base, id: "d", position: 0, completed: false }, { ...base, id: "e", position: 0, status: "in_progress" }], ex)).toEqual([]);
  });
});
