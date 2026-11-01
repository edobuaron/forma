import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog/catalog";
import { buildDraft, findHeaderRow, gridToRows, guessMapping, textToRows } from "../extract";
import { detectTable } from "../grid";
import type { LibraryEntry } from "../match";
import { readRun } from "../running";
import { applyOption, draftProblems, editRun, exerciseProblems, summarise, toPayload, treatAsExercise, treatAsRun } from "../review";
import type { PlanDraft } from "../types";

const library: LibraryEntry[] = [{ id: "lib-row", name: "Seated Cable Row", aliases: [], archived: false, catalogSlug: null }];
let n = 0;
const ctx = { library, catalog: CATALOG, newId: () => `id${++n}` };
function fromText(text: string): PlanDraft {
  const table = detectTable(text);
  if (table) {
    const header = findHeaderRow(table.grid);
    return buildDraft({ importId: "imp", sourceKind: "paste", sourceName: "p", ...gridToRows(table.grid, header, guessMapping(table.grid, header)) }, ctx);
  }
  return buildDraft({ importId: "imp", sourceKind: "paste", sourceName: "p", ...textToRows(text) }, ctx);
}
const rows = (d: PlanDraft) => d.workouts.flatMap((w) => w.exercises);

describe("reading a run", () => {
  it("time, distance and setting", () => {
    expect(readRun("Easy run 30 min", "")!.run).toMatchObject({ target_kind: "time", target_duration_s: 1800 });
    expect(readRun("Run 5 km", "")!.run).toMatchObject({ target_kind: "distance", target_distance_m: 5000 });
    expect(readRun("Run 5k", "")!.run).toMatchObject({ target_kind: "distance", target_distance_m: 5000 });
    expect(readRun("Run 3 miles", "")!.run.target_distance_m).toBeCloseTo(4828, 0);
    expect(readRun("Treadmill 20'", "")!.run).toMatchObject({ target_kind: "time", target_duration_s: 1200, setting: "treadmill" });
    expect(readRun("Corsa", "45 minuti")!.run).toMatchObject({ target_kind: "time", target_duration_s: 2700 });
  });
  it("intervals with distance or time work and recovery", () => {
    expect(readRun("Intervals", "6x400m", "90s")!.run).toMatchObject({ target_kind: "intervals", interval_count: 6, interval_work_m: 400, interval_work_s: null, interval_recovery_s: 90 });
    expect(readRun("Ripetute", "8 x 1 min / 1 min jog")!.run).toMatchObject({ interval_count: 8, interval_work_s: 60, interval_recovery_s: 60 });
    expect(readRun("Track intervals", "5 × 3:00 rec 2'")!.run).toMatchObject({ interval_count: 5, interval_work_s: 180, interval_recovery_s: 120, setting: "outdoor" });
  });
  it("asks instead of guessing", () => {
    const bare = readRun("Run 30", "")!;
    expect(bare.run.target_kind).toBe("open");
    expect(bare.flags[0]).toMatchObject({ code: "run_unit", blocking: true });
    expect(readRun("Run 30m", "")!.flags[0]).toMatchObject({ code: "run_unit", blocking: true });
    expect(readRun("Run 30-40 min", "")!.flags[0]).toMatchObject({ code: "run_range", blocking: true });
    expect(readRun("Run 5 km in 30 min", "")!.flags[0]).toMatchObject({ code: "run_two_targets", blocking: true });
    const rec = readRun("Intervals", "6x400m", "90")!;
    expect(rec.flags[0]).toMatchObject({ code: "rest_unit", blocking: true });
  });
  it("keeps pace and heart-rate instructions in notes, never as a target", () => {
    const r = readRun("Tempo run 20 min", "@ 4:50/km, zone 3")!;
    expect(r.run).toMatchObject({ target_kind: "time", target_duration_s: 1200 });
    expect(r.flags.some((f) => f.code === "unsupported" && !f.blocking)).toBe(true);
    expect(r.notes.join(" ")).toMatch(/4:50/);
  });
  it("names the run without its target", () => {
    expect(readRun("Easy run 30 min", "")!.run.name).toBe("Easy run");
    expect(readRun("Tempo run 20 min @ 4:50/km", "")!.run.name).toBe("Tempo run");
    expect(readRun("Long run 8-10 km", "")!.run.name).toBe("Long run");
    expect(readRun("Intervals", "6x400m")!.run.name).toBe("Intervals");
    expect(readRun("Run 5k", "")!.run.name).toBe("Run");
  });
  it("doesn't treat walking or lifting rows as runs", () => {
    expect(readRun("Incline treadmill walk 20 min", "")).toBeNull();
    expect(readRun("Seated cable row", "3x10")).toBeNull();
  });
});

describe("runs in an imported plan", () => {
  it("routes a mixed table to exercises and runs in order, and needs no exercise match for runs", () => {
    const d = fromText([
      "Exercise\tSets\tReps\tRest",
      "Easy run\t\t30 min\t",
      "Seated cable row\t3\t8-12\t90 sec",
      "Intervals\t6x400m\t\t90s",
    ].join("\n"));
    const [run, row, iv] = rows(d);
    expect(run.run).toMatchObject({ target_kind: "time", target_duration_s: 1800 });
    expect(row.run).toBeFalsy();
    expect(iv.run).toMatchObject({ target_kind: "intervals", interval_count: 6, interval_work_m: 400, interval_recovery_s: 90 });
    expect(exerciseProblems(run)).toEqual([]);
    expect(draftProblems(d)).toEqual([]);
    const payload = toPayload(d, 120);
    const items = payload.workouts[0].exercises;
    expect(items[0]).toMatchObject({ kind: "run", target_kind: "time", target_duration_s: 1800, target_distance_m: null });
    expect(items[1]).toMatchObject({ exercise_id: "lib-row", sets: 3 });
    expect(items[2]).toMatchObject({ kind: "run", interval_count: 6, interval_work_m: 400, interval_recovery_s: 90 });
    expect(summarise(d)).toMatchObject({ exercises: 1, runs: 2 });
  });
  it("reads free text runs, including before any heading", () => {
    const d = fromText("Easy run 30 min\nDay 1\nRun 5 km\nTreadmill 20'");
    expect(rows(d).map((e) => e.run?.target_kind)).toEqual(["time", "distance", "time"]);
  });
  it("blocks import until a question is answered, then uses the answer", () => {
    const d = fromText("Run 30");
    const [r] = rows(d);
    expect(exerciseProblems(r).length).toBeGreaterThan(0);
    const f = r.runFlags!.find((x) => x.code === "run_unit")!;
    const answered = applyOption(r, f.id, 0);
    expect(answered.run).toMatchObject({ target_kind: "time", target_duration_s: 1800 });
    expect(exerciseProblems(answered)).toEqual([]);
  });
  it("editing the target answers the question; 'Not a run' goes back to the exercise reading", () => {
    const [r] = rows(fromText("Run 30-40 min"));
    const edited = editRun(r, { target_kind: "time", target_duration_s: 2100 });
    expect(exerciseProblems(edited)).toEqual([]);
    const back = treatAsExercise(edited);
    expect(back.run).toBeNull();
    expect(exerciseProblems(back).length).toBeGreaterThan(0); // now it needs an exercise, sets and reps
    expect(treatAsRun(back).run).toBeTruthy();
  });
});
