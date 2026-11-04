import { describe, expect, it } from "vitest";
import { groupHistory } from "../queries";
import { emptySideColumns, type SetHistoryRow } from "../types";

const row = (id: string, position: number, reps: number, o: Partial<SetHistoryRow> = {}): SetHistoryRow => ({
  id, session_id: "s1", session_exercise_id: "se1", exercise_id: "ex1",
  started_at: new Date(Date.UTC(2026, 10, 1)).toISOString(), status: "completed", session_name: "W", bodyweight_kg: null,
  prescribed: {}, se_position: 0, position, kind: "working", weight_kg: 60, assistance_kg: null, reps, rir: null,
  completed: true, completed_at: null, shortfall_reason: null,
  ...emptySideColumns(), attachment_state: null, attachment_id: null, attachment_name: null, ...o,
});

describe("groupHistory", () => {
  it("puts sets in logged order whatever order the rows came in (pairing is by position)", () => {
    // completedSetHistory pages by id, so rows can arrive out of position order.
    const rows = [row("c", 2, 8), row("a", 0, 10), row("b", 1, 9)];
    expect(groupHistory(rows).get("ex1")![0].sets.map((s) => s.reps)).toEqual([10, 9, 8]);
  });

  it("carries the stored working-set number", () => {
    const rows = [row("a", 0, 10, { working_no: 1 }), row("b", 2, 8, { working_no: 3 })];
    expect(groupHistory(rows).get("ex1")![0].sets.map((s) => s.workingNo)).toEqual([1, 3]);
  });
});
