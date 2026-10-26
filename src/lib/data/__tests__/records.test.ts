import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeRecords } from "../mutations";
import type { ExerciseRow, SetHistoryRow } from "../types";

const exercise = { id: "ex1", name: "Row", category: "compound", load_type: "external", progression: "double_progression", increment_kg: 2.5, min_load_kg: 0, available_loads_kg: null, e1rm_eligible: true } as unknown as ExerciseRow;
const row = (session: string, day: number, weight: number): SetHistoryRow => ({
  id: `${session}-1`, session_id: session, session_exercise_id: `se-${session}`, exercise_id: "ex1",
  started_at: new Date(Date.UTC(2026, 9, day)).toISOString(), status: "completed", session_name: "W", bodyweight_kg: null,
  prescribed: {}, se_position: 0, position: 0, kind: "working", weight_kg: weight, assistance_kg: null, reps: 8, rir: null,
  completed: true, completed_at: null,
});

// Fake client: history reads return `history`, and replace_personal_records answers from `replies` in turn.
function fakeDb(replies: ({ message: string } | null)[]) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "gte"]) chain[m] = () => chain;
  chain.range = () => Promise.resolve({ data: [row("s1", 1, 60), row("s2", 8, 65)], error: null });
  const db = {
    from: (table: string) => {
      if (table !== "set_history") throw new Error(`unexpected direct write to ${table}`);
      return chain;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "personal_record_basis") return Promise.resolve({ data: `basis-${calls.length}`, error: null });
      return Promise.resolve({ data: null, error: replies.shift() ?? null });
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("recomputeRecords", () => {
  it("replaces records in one call, with the basis they were computed from", async () => {
    const { db, calls } = fakeDb([null]);
    await recomputeRecords(db, [exercise]);
    const replace = calls.filter((c) => c.fn === "replace_personal_records");
    expect(replace).toHaveLength(1);
    expect(replace[0].args).toMatchObject({ p_exercise_ids: ["ex1"], p_basis: "basis-1" });
    expect(replace[0].args.p_records).toEqual(expect.arrayContaining([expect.objectContaining({ session_id: "s2", type: "heaviest_load", value: 65 })]));
  });

  it("recomputes from fresh history when the server reports it changed", async () => {
    const { db, calls } = fakeDb([{ message: "stale_history" }, null]);
    await recomputeRecords(db, [exercise]);
    expect(calls.filter((c) => c.fn === "replace_personal_records").map((c) => c.args.p_basis)).toEqual(["basis-1", "basis-3"]);
  });

  it("fails loudly instead of reporting success", async () => {
    await expect(recomputeRecords(fakeDb([{ message: "permission denied" }]).db, [exercise])).rejects.toThrow("permission denied");
    const stale = { message: "stale_history" };
    await expect(recomputeRecords(fakeDb([stale, stale, stale]).db, [exercise])).rejects.toThrow(/kept changing/);
  });
});
