import { describe, expect, it } from "vitest";
import { interpretRow, parseEffort, parseLoad, parseRest, parseSetsReps, splitName } from "../notation";
import type { SourceRow } from "../types";

const row = (cells: SourceRow["cells"], extra: Partial<SourceRow> = {}): SourceRow => ({ ref: { label: "Row 2", text: "" }, cells, ...extra });
const codes = (r: { flags: { code: string; resolved?: boolean }[] }) => r.flags.map((f) => f.code);

describe("sets and reps", () => {
  it("reads common notations", () => {
    expect(parseSetsReps("3x10")).toMatchObject({ sets: 3, repMin: 10, repMax: 10 });
    expect(parseSetsReps("4 × 8–12")).toMatchObject({ sets: 4, repMin: 8, repMax: 12 });
    expect(parseSetsReps("3 sets of 6 to 8 reps")).toMatchObject({ sets: 3, repMin: 6, repMax: 8 });
    expect(parseSetsReps("4 serie da 10")).toMatchObject({ sets: 4, repMin: 10, repMax: 10 });
    expect(parseSetsReps("3*12")).toMatchObject({ sets: 3, repMin: 12 });
  });

  it("asks about different reps per set instead of guessing", () => {
    for (const s of ["3x12/10/8", "3 x 12, 10, 8", "12-10-8"]) {
      const r = parseSetsReps(s);
      expect(r.repMin).toBeNull();
      expect(r.flags[0]).toMatchObject({ code: "ambiguous_reps", blocking: true });
      expect(r.flags[0].options?.[0].patch).toEqual({ repMin: 8, repMax: 12 });
    }
    expect(parseSetsReps("3x12/10/8").sets).toBe(3);
    // A range and a comma after the reps keep their usual meaning.
    expect(parseSetsReps("3x8-10").flags).toEqual([]);
    expect(parseSetsReps("3x10, 2 min rest")).toMatchObject({ sets: 3, repMin: 10, repMax: 10, flags: [] });
  });

  it("flags timed sets and AMRAP rather than inventing reps", () => {
    expect(parseSetsReps("3x30s")).toMatchObject({ sets: 3, repMin: null });
    expect(codes(parseSetsReps("3x30s"))).toEqual(["time_based"]);
    expect(codes(parseSetsReps("3 x 45\""))).toEqual(["time_based"]);
    expect(codes(parseSetsReps("3xAMRAP"))).toEqual(["amrap"]);
  });

  it("counts '3×10 each side' as three planned sets, reps per side", () => {
    const r = interpretRow(row({ exercise: "Bulgarian split squat", setsReps: "3×10 each side" }));
    expect(r.values).toMatchObject({ sets: 3, repMin: 10, repMax: 10, perSide: true });
    expect(r.flags.find((f) => f.code === "per_side")).toMatchObject({ blocking: false });
    expect(interpretRow(row({ exercise: "Affondi", setsReps: "3x12 per gamba" })).values).toMatchObject({ sets: 3, perSide: true });
    // "each" on a load (dumbbells) is not "each side".
    expect(interpretRow(row({ exercise: "DB press", setsReps: "3x10", load: "20 kg each" })).values.perSide).toBe(false);
  });
});

describe("rest", () => {
  it("never confuses minutes and seconds", () => {
    expect(parseRest("90s").restS).toBe(90);
    expect(parseRest("90 sec").restS).toBe(90);
    expect(parseRest('90"').restS).toBe(90);
    expect(parseRest("2 min").restS).toBe(120);
    expect(parseRest("2'").restS).toBe(120);
    expect(parseRest("1'30\"").restS).toBe(90);
    expect(parseRest("1:30").restS).toBe(90);
    expect(parseRest("1'30").restS).toBe(90);
    expect(parseRest("3' 2 warm-up sets").restS).toBe(180);
    expect(parseRest("1,5 min").restS).toBe(90);
    expect(parseRest("2 minuti").restS).toBe(120);
  });

  it("uses a unit stated by the header", () => {
    expect(parseRest("2", "min").restS).toBe(120);
    expect(parseRest("90", "s").restS).toBe(90);
  });

  it("asks when a bare number could be either", () => {
    const r = parseRest("2");
    expect(r.restS).toBeNull();
    expect(r.flags[0]).toMatchObject({ code: "rest_unit", blocking: true });
    expect(r.flags[0].options?.map((o) => o.patch.restS)).toEqual([2, 120]);
    // 90 minutes isn't a valid rest, so only seconds remains, and it's stated.
    const r90 = parseRest("90");
    expect(r90).toMatchObject({ restS: 90, origin: "interpreted" });
    expect(r90.flags[0]).toMatchObject({ code: "rest_unit", blocking: false });
  });

  it("asks which end of a range to use", () => {
    const r = parseRest("60-90 s");
    expect(r.restS).toBeNull();
    expect(r.flags[0].options?.map((o) => o.patch.restS)).toEqual([60, 90]);
    expect(parseRest("2-3 min").flags[0].options?.map((o) => o.patch.restS)).toEqual([120, 180]);
  });
});

describe("effort", () => {
  it("keeps RPE and RIR apart", () => {
    expect(parseEffort("RPE 8")).toMatchObject({ targetRpe: 8, targetRir: null });
    expect(parseEffort("2 RIR")).toMatchObject({ targetRir: 2, targetRpe: null });
    expect(parseEffort("rir 1")).toMatchObject({ targetRir: 1 });
    expect(parseEffort("8", "rpe")).toMatchObject({ targetRpe: 8, targetRir: null });
    expect(parseEffort("2", "rir")).toMatchObject({ targetRir: 2, targetRpe: null });
    expect(parseEffort("8,5", "rpe").targetRpe).toBe(8.5);
  });

  it("doesn't read reps as effort", () => {
    expect(interpretRow(row({ exercise: "Squat", setsReps: "3x10 RPE 8" })).values).toMatchObject({ repMin: 10, targetRpe: 8, targetRir: null });
    expect(interpretRow(row({ exercise: "Squat", setsReps: "3x10 2 RIR" })).values).toMatchObject({ repMin: 10, targetRir: 2, targetRpe: null });
  });

  it("asks when the scale isn't named", () => {
    const r = parseEffort("8", "effort");
    expect(r.flags[0]).toMatchObject({ code: "effort_unclear", blocking: true });
    expect(r.flags[0].options?.map((o) => o.patch)).toEqual([{ targetRir: 8 }, { targetRpe: 8 }]);
    expect(codes(parseEffort("@8"))).toEqual(["effort_unclear"]);
    expect(parseEffort("@ 60kg").flags).toEqual([]);
    expect(codes(parseEffort("RPE 7-8"))).toEqual(["effort_range"]);
  });
});

describe("load", () => {
  it("reads decimal commas and converts pounds, keeping what was written", () => {
    expect(parseLoad("62,5 kg").loadKg).toBe(62.5);
    expect(parseLoad("62.5kg").loadKg).toBe(62.5);
    expect(parseLoad("135 lb")).toMatchObject({ loadKg: 61.23, origin: "interpreted" });
    expect(parseLoad("60", "kg", true).loadKg).toBe(60);
  });

  it("never converts percentages and asks about a missing unit", () => {
    expect(parseLoad("70% 1RM")).toMatchObject({ loadKg: null });
    expect(codes(parseLoad("70% 1RM"))).toEqual(["load_percent"]);
    expect(parseLoad("40", undefined, true).flags[0]).toMatchObject({ code: "load_unit", blocking: true });
    expect(parseLoad("BW")).toMatchObject({ loadKg: null, flags: [] });
  });
});

describe("warm-ups, drop sets, supersets and unsupported instructions", () => {
  it("recognises prescribed warm-up sets", () => {
    expect(interpretRow(row({ exercise: "Bench press", setsReps: "2 warm-up sets + 3x8" })).values).toMatchObject({ warmupSets: 2, sets: 3, repMin: 8 });
    expect(interpretRow(row({ exercise: "Squat", setsReps: "3x5", notes: "+2 WU" })).values.warmupSets).toBe(2);
    const vague = interpretRow(row({ exercise: "Squat", setsReps: "3x5", notes: "warm up first" }));
    expect(vague.values.warmupSets).toBe(0);
    expect(codes(vague)).toContain("warmup_count");
  });

  it("treats a general warm-up line as the workout's warm-up, not an exercise", () => {
    expect(interpretRow(row({ exercise: "Warm-up: 5 min bike" })).warmupRow).toBe(true);
  });

  it("recognises drop sets and asks for what isn't stated", () => {
    const full = interpretRow(row({ exercise: "Lateral raise", setsReps: "3x12", notes: "2 drops on the last set" }));
    expect(full.values).toMatchObject({ sets: 3, dropSegments: 2, dropScope: "last_set" });
    expect(full.flags.filter((f) => f.field === "drop")).toEqual([]);
    const vague = interpretRow(row({ exercise: "Leg extension", setsReps: "3x12 + drop set" }));
    expect(vague.values).toMatchObject({ sets: 3, dropSegments: 0, dropScope: null });
    expect(codes(vague)).toEqual(expect.arrayContaining(["drop_count", "drop_scope"]));
    expect(interpretRow(row({ exercise: "Curl", setsReps: "3x10 stripping ultima serie" })).values.dropScope).toBe("last_set");
  });

  it("reads superset labels and order prefixes", () => {
    expect(splitName("A1. Incline press")).toEqual({ name: "Incline press", label: "A", optional: false });
    expect(splitName("1) Squat")).toEqual({ name: "Squat", label: null, optional: false });
    expect(interpretRow(row({ order: "B2", exercise: "Curl", setsReps: "3x10" })).supersetLabel).toBe("B");
    expect(codes(interpretRow(row({ exercise: "Curl", setsReps: "3x10", notes: "superset with pushdown" })))).toContain("superset_unclear");
  });

  it("keeps unsupported instructions visible", () => {
    const r = interpretRow(row({ exercise: "Leg press", setsReps: "3x10 rest-pause" }));
    expect(codes(r)).toContain("unsupported");
    expect(r.values.notes).toContain("rest-pause");
    expect(r.values).toMatchObject({ sets: 3, repMin: 10 });
  });

  it("reads full notation in a reps column and asks when it contradicts the sets column", () => {
    expect(interpretRow(row({ exercise: "Squat", reps: "3x8-10 RIR 2" })).values).toMatchObject({ sets: 3, repMin: 8, repMax: 10, targetRir: 2 });
    const r = interpretRow(row({ exercise: "Squat", sets: "4", reps: "3x8-10" }));
    expect(r.values).toMatchObject({ sets: 4, repMin: 8, repMax: 10 });
    expect(r.flags.find((f) => f.field === "sets")).toMatchObject({ blocking: true });
    expect(r.flags.find((f) => f.field === "sets")!.options!.map((o) => o.patch.sets)).toEqual([4, 3]);
  });

  it("requires sets and reps", () => {
    const r = interpretRow(row({ exercise: "Plank" }));
    expect(r.flags.filter((f) => f.blocking).map((f) => f.code)).toEqual(["missing_sets", "missing_reps"]);
  });

  it("doesn't join a rest in minutes with the next number", () => {
    const r = interpretRow(row({ exercise: "Back squat", setsReps: "4x5 rest 3' 2 warm-up sets" }));
    expect(r.values).toMatchObject({ sets: 4, repMin: 5, restS: 180, warmupSets: 2 });
  });

  it("reads tempo and rest from free text", () => {
    const r = interpretRow(row({ exercise: "Romanian deadlift", setsReps: "3x8-10 rest 2' tempo 3-1-1-0 RIR 2" }));
    expect(r.values).toMatchObject({ sets: 3, repMin: 8, repMax: 10, restS: 120, tempo: "3-1-1-0", targetRir: 2 });
    expect(r.flags.filter((f) => f.blocking)).toEqual([]);
  });
});
