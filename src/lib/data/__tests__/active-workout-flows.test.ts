import { describe, expect, it } from "vitest";
import { counterpart } from "@/lib/domain/comparison";
import { planCopy } from "@/lib/domain/previous-copy";
import { adjustRest, progress, remainingS, restFor, restoreRest, setRestLength, startRest } from "@/lib/domain/rest";
import { setPerformed } from "@/lib/domain/sides";
import { planSwap, proposeTargets, suggestSubstitutes, type SubstituteCandidate } from "@/lib/domain/substitution";
import type { LoggedSet } from "@/lib/domain/types";
import { swapText } from "@/components/workout/format";
import { restTrigger } from "../rest-rules";
import { addDropSegment, patchSide, plannedForProgress, plannedSets, reconcileSet, setSideCompleted, type SetRow } from "../set-rows";
import { emptySideColumns, toLoggedSet } from "../types";

const row = (id: string, position: number, o: Partial<SetRow> = {}): SetRow => ({
  id, position, kind: "working", weight_kg: null, assistance_kg: null, reps: null, rir: null,
  completed: false, completed_at: null, notes: null, ...emptySideColumns(), ...o,
});
const sided = (id: string, position: number, o: Partial<SetRow> = {}) => row(id, position, { ...emptySideColumns(true), ...o });
const done = (id: string, position: number, kg: number, reps: number, o: Partial<SetRow> = {}) =>
  row(id, position, { weight_kg: kg, reps, completed: true, completed_at: "t", ...o });
const ls = (o: Partial<LoggedSet>): LoggedSet => ({ kind: "working", weightKg: null, assistanceKg: null, reps: null, rir: null, completed: true, ...o });
const ex = { loadType: "external" as const };

// ---------- previous-set reference and copy ----------

describe("previous set reference", () => {
  const previous = [ls({ kind: "warmup", weightKg: 20, reps: 10 }), ls({ weightKg: 60, reps: 10, rir: 2 }), ls({ kind: "drop", weightKg: 40, reps: 8 }), ls({ weightKg: 60, reps: 9 })];

  it("pairs by working-set position: warm-ups and drops never shift it", () => {
    expect(counterpart(previous, 0, ex).previous).toMatchObject({ weightKg: 60, reps: 10, rir: 2 });
    expect(counterpart(previous, 1, ex).previous).toMatchObject({ weightKg: 60, reps: 9 });
  });

  it("a set beyond last time's is an extra set; a skipped position stays missing", () => {
    expect(counterpart(previous, 2, ex)).toEqual({ previous: null, extra: true });
    const skipped = [ls({ weightKg: 60, reps: 10, workingNo: 1 }), ls({ weightKg: 60, reps: 8, workingNo: 3 })];
    expect(counterpart(skipped, 1, ex)).toEqual({ previous: null, extra: false });
    expect(counterpart(skipped, 2, ex).previous).toMatchObject({ reps: 8 });
  });

  it("copy fills empty fields only and reports entered values as conflicts", () => {
    expect(planCopy({ load: null, reps: null, rir: null }, { load: 60, reps: 10, rir: 2 }, { includeRir: true }))
      .toEqual({ fill: { load: 60, reps: 10, rir: 2 }, conflicts: {}, same: false });
    expect(planCopy({ load: 62.5, reps: null, rir: null }, { load: 60, reps: 10, rir: 2 }, { includeRir: false }))
      .toEqual({ fill: { reps: 10 }, conflicts: { load: 60 }, same: false });
    expect(planCopy({ load: 60, reps: 10, rir: 3 }, { load: 60, reps: 10, rir: null }, { includeRir: true }).same).toBe(true);
  });

  it("copying values never marks a set done, together or per side", () => {
    const s = reconcileSet({ ...row("a", 0), weight_kg: 60, reps: 10, rir: 2 }, "external");
    expect(s.completed).toBe(false);
    const side = patchSide(sided("b", 0), "right", { weight_kg: 22.5, reps: 8 }, "external");
    expect(side).toMatchObject({ right_weight_kg: 22.5, right_reps: 8, right_completed: false, left_weight_kg: null, completed: false });
  });
});

// ---------- rest timer ----------

describe("rest timer", () => {
  const t0 = 1_000_000;

  it("time left comes from the stored deadline, not a counter", () => {
    const r = startRest(90, t0, { label: "Bench", itemId: "x", source: "prescribed" });
    expect(remainingS(r, t0)).toBe(90);
    // Back from the background 70 s later: the right time, without any ticks in between.
    expect(remainingS(r, t0 + 70_000)).toBe(20);
    expect(remainingS(r, t0 + 200_000)).toBe(0);
    expect(progress(r, t0 + 45_000)).toBeCloseTo(0.5);
  });

  it("rapid adjustments each count once and never end before now", () => {
    let r = startRest(60, t0, { label: "Row" });
    for (let i = 0; i < 4; i++) r = adjustRest(r, 15, t0 + 1000);
    expect(remainingS(r, t0 + 1000)).toBe(119);
    for (let i = 0; i < 20; i++) r = adjustRest(r, -15, t0 + 1000);
    expect(r.endAt).toBe(t0 + 1000);
    expect(remainingS(r, t0 + 1000)).toBe(0);
    // Adding time after the rest is over counts from now.
    expect(remainingS(adjustRest(r, 15, t0 + 50_000), t0 + 50_000)).toBe(15);
  });

  it("a changed length counts from the start of the rest", () => {
    const r = setRestLength(startRest(120, t0, { label: "Squat" }), 90, t0 + 30_000);
    expect(remainingS(r, t0 + 30_000)).toBe(60);
    expect(r.source).toBe("override");
  });

  it("restores from storage after a reload, and drops stale or broken values", () => {
    const r = startRest(90, t0, { label: "Bench" });
    expect(restoreRest(JSON.parse(JSON.stringify(r)), t0 + 30_000)).toMatchObject({ endAt: r.endAt, startedAt: t0 });
    expect(restoreRest(r, t0 + 90_000 + 5_000)).not.toBeNull(); // just finished: shows "Rest complete"
    expect(restoreRest(r, t0 + 90_000 + 120_000)).toBeNull();
    expect(restoreRest({ endAt: "soon" }, t0)).toBeNull();
    expect(restoreRest({ endAt: t0 + 3 * 3600_000 }, t0)).toBeNull();
    // A state stored by the previous version (no startedAt) still restores.
    expect(restoreRest({ endAt: t0 + 60_000, duration: 90, label: "Old" }, t0)).toMatchObject({ startedAt: t0 - 30_000 });
  });

  it("uses an explicit override, then the prescription, the exercise default and the profile default", () => {
    expect(restFor({ overrideS: 75, prescribedS: 120, exerciseS: 90, profileS: 60 })).toEqual({ seconds: 75, source: "override" });
    expect(restFor({ prescribedS: 120, exerciseS: 90, profileS: 60 })).toEqual({ seconds: 120, source: "prescribed" });
    expect(restFor({ prescribedS: null, exerciseS: 90, profileS: 60 })).toEqual({ seconds: 90, source: "exercise" });
    expect(restFor({ profileS: 60 })).toEqual({ seconds: 60, source: "default" });
  });
});

describe("when completing a set starts rest", () => {
  it("normal sets rest; warm-ups don't", () => {
    expect(restTrigger([done("a", 0, 60, 10)], "a")).toBe("rest");
    expect(restTrigger([done("w", 0, 20, 10, { kind: "warmup" }), row("a", 1)], "w")).toBe("none");
  });

  it("a drop sequence rests once, after its last segment", () => {
    let sets: SetRow[] = [done("a", 0, 60, 10)];
    sets = addDropSegment(sets, "a", "d1")!.sets;
    sets = addDropSegment(sets, "a", "d2")!.sets;
    expect(restTrigger(sets, "a")).toBe("none");
    sets = sets.map((s) => (s.id === "d1" ? { ...s, weight_kg: 45, reps: 8, completed: true } : s));
    expect(restTrigger(sets, "d1")).toBe("none");
    sets = sets.map((s) => (s.id === "d2" ? { ...s, weight_kg: 30, reps: 8, completed: true } : s));
    expect(restTrigger(sets, "d2")).toBe("rest");
  });

  it("a left/right pair rests once both sides are done; between sides only when turned on", () => {
    const left = setSideCompleted(sided("a", 0), "left", true, "t", { weight_kg: 20, reps: 10 });
    expect(restTrigger([left], "a", { side: "left" })).toBe("none");
    expect(restTrigger([left], "a", { side: "left", betweenSides: true })).toBe("between_sides");
    const both = setSideCompleted(left, "right", true, "t", { weight_kg: 20, reps: 9 });
    expect(restTrigger([both], "a", { side: "right", betweenSides: true })).toBe("rest");
    // A side set with drops continues on that side: no between-sides rest.
    const withDrop = addDropSegment([left], "a", "d")!.sets;
    expect(restTrigger(withDrop, "a", { side: "left", betweenSides: true })).toBe("none");
  });
});

// ---------- substitutions ----------

const cand = (id: string, o: Partial<SubstituteCandidate>): SubstituteCandidate => ({
  id, name: id, primary_muscles: [], secondary_muscles: [], equipment: "barbell", category: "compound", load_type: "external", ...o,
});

describe("swap suggestions", () => {
  const bench = cand("bench", { primary_muscles: ["chest"], secondary_muscles: ["triceps", "front_delts"], group: "chest" });
  const lib = [
    bench,
    cand("db-press", { primary_muscles: ["chest"], secondary_muscles: ["triceps", "front_delts"], equipment: "dumbbell", group: "chest" }),
    cand("fly", { primary_muscles: ["chest"], equipment: "cable", category: "isolation" }),
    cand("curl", { primary_muscles: ["biceps"], equipment: "dumbbell", category: "isolation" }),
    cand("old-press", { primary_muscles: ["chest"], archived_at: "2026-01-01" }),
  ];

  it("needs a shared primary muscle, ranks closer matches first and skips archived exercises", () => {
    const s = suggestSubstitutes(bench, lib);
    expect(s.map((x) => x.exercise.id)).toEqual(["db-press", "fly"]);
    expect(s[0].reasons).toContain("Uses dumbbells");
  });

  it("an exercise without recorded muscles gets no guesses", () => {
    expect(suggestSubstitutes(cand("x", {}), lib)).toEqual([]);
  });
});

describe("planning a swap", () => {
  const performed = (s: SetRow) => setPerformed(toLoggedSet(s));

  it("before logging, every set moves", () => {
    const p = planSwap([row("a", 0), row("b", 1), row("c", 2)], performed);
    expect(p).toMatchObject({ hasLogged: false, movedWorking: 3 });
  });

  it("after logging, logged sets and their drops stay; only undone sets move", () => {
    let sets: SetRow[] = [row("w", 0, { kind: "warmup", weight_kg: 20, reps: 10, completed: true }), done("a", 1, 60, 10), row("b", 2), row("c", 3)];
    sets = addDropSegment(sets, "a", "d")!.sets; // an empty drop under a logged set stays with it
    const p = planSwap(sets, performed);
    expect(p.keep.map((s) => s.id)).toEqual(["w", "a", "d"]);
    expect(p.move.map((s) => s.id)).toEqual(["b", "c"]);
    expect(p.movedWorking).toBe(2);
  });

  it("a set with one side done counts as logged work and stays", () => {
    const half = setSideCompleted(sided("a", 0), "left", true, "t", { weight_kg: 20, reps: 10 });
    expect(planSwap([half, sided("b", 1)], performed).keep.map((s) => s.id)).toEqual(["a"]);
  });

  it("proposed targets carry sets, reps and rest, never load", () => {
    const t = proposeTargets({ sets: 4, rep_min: 6, rep_max: 8, rest_s: 150 }, { default_sets: 3, default_rep_min: 10, default_rep_max: 12, default_rest_s: 90 }, 2);
    expect(t).toEqual({ sets: 2, rep_min: 6, rep_max: 8, rest_s: 150 });
    expect(Object.keys(t)).not.toContain("target_weight_kg");
  });

  it("progress counts the original's kept sets only; its prescription stays short of plan", () => {
    const rx = { sets: 4, swapped_to: { item: "r", exercise_id: "x", name: "Dumbbell press", sets_moved: 2, at: "t" } };
    const kept = [done("a", 0, 60, 10), done("b", 1, 60, 9)];
    expect(plannedForProgress(rx, kept)).toBe(2);
    expect(plannedSets(rx, kept)).toBe(4);
  });

  it("History explains both sides of a swap", () => {
    expect(swapText({ prescribed: { swap: { from_name: "Bench press", scope: "today" } }, substituted_for: "b" })).toBe("Swapped in for Bench press");
    expect(swapText({ prescribed: { swapped_to: { name: "Dumbbell press", sets_moved: 1 } }, substituted_for: null })).toBe("Swapped to Dumbbell press for the remaining 1 set");
    expect(swapText({ prescribed: {}, substituted_for: "b" }, () => "Bench press")).toBe("Substituted for Bench press");
    expect(swapText({ prescribed: {}, substituted_for: null })).toBeNull();
  });
});
