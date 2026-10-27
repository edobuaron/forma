import { describe, expect, it } from "vitest";
import { nextAvailableLoad, previousAvailableLoad } from "../loads";
import { headline, recommend } from "../progression";
import { ex, perf, rx, set } from "./helpers";

const s3 = (w: number, a: number, b: number, c: number, rir: number | null = null) => [
  set(w, a, { rir }), set(w, b, { rir }), set(w, c, { rir }),
];

describe("double progression (3 × 6–10)", () => {
  const e = ex();
  it("10/9/8 → keep load, improve reps (10/10/9)", () => {
    const r = recommend(e, rx(), [perf(s3(60, 10, 9, 8))]);
    expect(r.action).toBe("hold_build_reps");
    expect(r.targetLoadKg).toBe(60);
    expect(r.targetReps).toEqual([10, 10, 9]);
    expect(headline(r, e, "kg")).toBe("Keep 60 kg. Aim for 10 / 10 / 9.");
  });
  it("10/10/9 → keep load, target the final rep", () => {
    const r = recommend(e, rx(), [perf(s3(60, 10, 10, 9))]);
    expect(r.targetReps).toEqual([10, 10, 10]);
  });
  it("10/10/10 → next available load", () => {
    const r = recommend(e, rx(), [perf(s3(60, 10, 10, 10))]);
    expect(r.action).toBe("increase_load");
    expect(r.targetLoadKg).toBe(62.5);
    expect(headline(r, e, "kg")).toBe("All target reps achieved. Consider 62.5 kg today.");
  });
  it("one improved set does not trigger an increase", () => {
    const r = recommend(e, rx(), [perf(s3(60, 10, 8, 8)), perf(s3(60, 8, 8, 8), 7)]);
    expect(r.action).toBe("hold_build_reps");
  });
  it("top of range at RIR 0 → repeat before increasing", () => {
    const r = recommend(e, rx(), [perf(s3(60, 10, 10, 10, 0))]);
    expect(r.action).toBe("hold_effort");
  });
  it("incomplete last session → repeat", () => {
    const r = recommend(e, rx(), [perf([set(60, 10), set(60, 10)])]);
    expect(r.action).toBe("hold_incomplete");
  });
  it("below previous performance at same load → hold", () => {
    const r = recommend(e, rx(), [perf(s3(60, 8, 7, 6)), perf(s3(60, 10, 9, 8), 7)]);
    expect(r.action).toBe("hold_below");
    expect(headline(r, e, "kg")).toMatch(/below your normal performance/);
  });
  it("first time → no invented load", () => {
    const r = recommend(e, rx(), []);
    expect(r.action).toBe("first_time");
    expect(r.targetLoadKg).toBeNull();
  });
  it("below rep range twice → suggests (not applies) a lighter available load", () => {
    const r = recommend(e, rx(), [perf(s3(60, 5, 5, 4)), perf(s3(60, 5, 5, 5), 7)]);
    expect(r.action).toBe("consider_reduce");
    expect(r.targetLoadKg).toBe(57.5);
  });
});

describe("exercise-specific behaviour", () => {
  it("reps-first (lateral raises) needs two sessions at the top", () => {
    const lat = ex({ progression: "reps_first", incrementKg: 1.25, e1rmEligible: false, category: "isolation" });
    const p = rx({ sets: 2, repMin: 12, repMax: 20 });
    const once = recommend(lat, p, [perf([set(10, 20), set(10, 20)]), perf([set(10, 19), set(10, 18)], 7)]);
    expect(once.action).toBe("hold_confirm");
    const twice = recommend(lat, p, [perf([set(10, 20), set(10, 20)]), perf([set(10, 20), set(10, 20)], 7)]);
    expect(twice.action).toBe("increase_load");
    expect(twice.targetLoadKg).toBe(11.25);
  });
  it("respects explicit available loads (never suggests unavailable weights)", () => {
    const db = ex({ availableLoadsKg: [20, 22, 24, 26, 28], incrementKg: 2 });
    expect(nextAvailableLoad(24, db)).toBe(26);
    expect(nextAvailableLoad(28, db)).toBeNull();
    const r = recommend(db, rx(), [perf(s3(28, 10, 10, 10))]);
    expect(r.action).toBe("hold_build_reps");
    expect(r.reasons[0]).toMatch(/no heavier load/);
  });
  it("snaps off-grid loads up to the next grid step", () => {
    expect(nextAvailableLoad(61, { incrementKg: 2.5, minLoadKg: 0, availableLoadsKg: null })).toBe(62.5);
    expect(previousAvailableLoad(60, { incrementKg: 2.5, minLoadKg: 0, availableLoadsKg: null })).toBe(57.5);
    expect(nextAvailableLoad(22, { incrementKg: 2, minLoadKg: 0, availableLoadsKg: null })).toBe(24);
  });
  it("weighted pull-ups progress added weight in small steps", () => {
    const pu = ex({ loadType: "weighted_bodyweight", category: "weighted_bodyweight", incrementKg: 1.25, e1rmEligible: false });
    const r = recommend(pu, rx({ repMin: 4, repMax: 6 }), [perf(s3(15, 6, 6, 6))]);
    expect(r.targetLoadKg).toBe(16.25);
    expect(headline(r, pu, "kg")).toBe("All target reps achieved. Consider +16.25 kg today.");
  });
  it("bodyweight dips: more reps or a small load, never a forced increase", () => {
    const dip = ex({ loadType: "bodyweight", category: "bodyweight", progression: "bodyweight_reps", e1rmEligible: false });
    const r = recommend(dip, rx({ sets: 2, repMin: 5, repMax: 8 }), [perf([set(0, 8), set(0, 8)])]);
    expect(r.action).toBe("add_reps_or_load");
  });
  it("skill work never gets load progression", () => {
    const sk = ex({ category: "skill", loadType: "bodyweight", progression: "skill", e1rmEligible: false });
    const r = recommend(sk, rx({ repMin: 2, repMax: 3 }), [perf(s3(0, 3, 3, 3))]);
    expect(r.action).toBe("skill");
  });
});

describe("shortened workouts (planned sets omitted)", () => {
  const e = ex();
  const short = (o: Parameters<typeof perf>[2] = {}) => perf([set(60, 10), set(60, 10)], 0, { prescription: rx(), ...o });

  it.each(["time", "equipment"] as const)("%s → workout ended early, keep load and resume planned sets", (reason) => {
    const r = recommend(e, rx(), [short({ shortfallReason: reason })]);
    expect(r.action).toBe("hold_shortened");
    expect(r.targetLoadKg).toBe(60);
    expect(headline(r, e, "kg")).toBe("Workout ended early. Keep 60 kg and resume planned sets.");
    expect(r.reasons.join(" ")).toMatch(/not counted as failed/);
  });

  it("no reason → neutral wording, never assumes fatigue or an incomplete performance", () => {
    const r = recommend(e, rx(), [short()]);
    expect(r.action).toBe("hold_incomplete");
    const text = [headline(r, e, "kg"), ...r.reasons].join(" ");
    expect(text).toBe(
      "Fewer sets than planned last time. Keep 60 kg and resume planned sets. Last session logged 2 of 3 working sets. " +
      "No reason was recorded for the omitted sets. No change in performance is inferred. " +
      "Keep this load and resume the planned sets; there isn't enough evidence to increase it.",
    );
    expect(text).not.toMatch(/incomplete|fatigue|fail/i);
  });

  it("fatigue and other still hold the load", () => {
    for (const reason of ["fatigue", "other"] as const) {
      const r = recommend(e, rx(), [short({ shortfallReason: reason })]);
      expect(r.action).toBe("hold_incomplete");
      expect(r.targetLoadKg).toBe(60);
    }
  });

  it("completed sets at the top of the range never trigger an increase when sets were omitted", () => {
    const r = recommend(e, rx(), [short({ shortfallReason: "time" }), perf(s3(60, 10, 10, 10), 7)]);
    expect(r.action).toBe("hold_shortened");
    expect(r.targetLoadKg).toBe(60);
    expect(r.targetReps).toEqual([10, 10]); // only real, completed sets — no zero-rep placeholders
  });

  it("a fully completed exercise keeps normal progression, whatever the session reason", () => {
    const r = recommend(e, rx(), [perf(s3(60, 10, 10, 10), 0, { prescription: rx(), shortfallReason: "time" })]);
    expect(r.action).toBe("increase_load");
    expect(r.targetLoadKg).toBe(62.5);
  });

  it("the next full session after a shortened one is not judged as below normal", () => {
    const r = recommend(e, rx(), [perf(s3(60, 9, 8, 8), 0, { prescription: rx() }), short({ shortfallReason: "time" })]);
    expect(r.action).toBe("hold_build_reps");
  });
});
