import { describe, expect, it } from "vitest";
import { epley } from "../e1rm";
import { detectPRs } from "../prs";
import { sessionPoints, weekStart } from "../analytics";
import { exerciseInsights, volumeInsights } from "../insights";
import { ex, perf, set } from "./helpers";

describe("e1RM", () => {
  it("Epley, limited to 1–12 reps", () => {
    expect(epley(100, 1)).toBe(100);
    expect(epley(60, 10)).toBeCloseTo(80);
    expect(epley(60, 15)).toBeNull();
  });
});

describe("detectPRs", () => {
  const e = ex();
  it("no PRs on the first ever session", () => {
    expect(detectPRs(e, [set(60, 10)], [])).toEqual([]);
  });
  it("heaviest set, reps at load and e1RM", () => {
    const hist = [set(60, 8), set(60, 10)];
    const prs = detectPRs(e, [set(62.5, 9), set(60, 11)], hist);
    const types = prs.map((p) => p.type).sort();
    expect(types).toEqual(["best_e1rm", "heaviest_load", "reps_at_load"]);
  });
  it("no e1RM records for isolation lifts", () => {
    const lat = ex({ e1rmEligible: false, category: "isolation" });
    const prs = detectPRs(lat, [set(12.5, 15)], [set(10, 15)]);
    expect(prs.map((p) => p.type)).toEqual(["heaviest_load"]);
  });
  it("weighted pull-up: external-load record; bodyweight reps record separately", () => {
    const pu = ex({ loadType: "weighted_bodyweight", category: "weighted_bodyweight", e1rmEligible: false });
    expect(detectPRs(pu, [set(17.5, 5)], [set(15, 6)]).map((p) => p.type)).toEqual(["heaviest_load"]);
    expect(detectPRs(pu, [set(0, 13)], [set(0, 12), set(15, 5)]).map((p) => p.type)).toEqual(["most_reps"]);
  });
  it("first muscle-up is a record; transitions are not", () => {
    const mu = ex({ name: "Bar Muscle-Up", category: "skill", loadType: "bodyweight", e1rmEligible: false });
    expect(detectPRs(mu, [set(0, 1)], []).map((p) => p.type)).toEqual(["first_skill"]);
    const tr = ex({ name: "Assisted Muscle-Up Transition", category: "skill", loadType: "assisted", e1rmEligible: false });
    expect(detectPRs(tr, [set(null, 3, { assistanceKg: 10 })], [])).toEqual([]);
    expect(detectPRs(tr, [set(null, 3, { assistanceKg: 10 })], [set(null, 3, { assistanceKg: 15 })]).map((p) => p.type)).toEqual(["least_assistance"]);
  });
});

describe("sessionPoints", () => {
  it("recognises week 3 (62.5×8) as stronger context than week 1 (60×8)", () => {
    const pts = sessionPoints(ex(), [perf([set(62.5, 8)], 0), perf([set(60, 10)], 7), perf([set(60, 8)], 14)]);
    expect(pts.map((p) => p.topLoadKg)).toEqual([60, 60, 62.5]);
    expect(pts[2].bestE1rmKg!).toBeGreaterThan(pts[0].bestE1rmKg!);
  });
});

describe("insights", () => {
  const pu = ex({ id: "pu", name: "Weighted Pull-Up", loadType: "weighted_bodyweight", category: "weighted_bodyweight", e1rmEligible: false });
  const s3 = (a: number, b: number, c: number) => [set(10, a), set(10, b), set(10, c)];
  it("needs three comparable sessions; one bad session is not a trend", () => {
    expect(exerciseInsights(pu, [perf(s3(4, 4, 3)), perf(s3(6, 6, 5), 7)])).toEqual([]);
  });
  it("flags decline across three comparable sessions", () => {
    const i = exerciseInsights(pu, [perf(s3(4, 4, 3), 0), perf(s3(5, 5, 4), 7), perf(s3(6, 6, 5), 14)]);
    expect(i[0].key).toBe("decline:pu");
    expect(i[0].detail).not.toMatch(/overtrain/i);
  });
  it("lateral-raise plateau → reps first", () => {
    const lat = ex({ id: "lat", name: "Cable Lateral Raise", progression: "reps_first", e1rmEligible: false, category: "isolation" });
    const p = (d: number) => perf([set(10, 15), set(10, 14)], d);
    const i = exerciseInsights(lat, [p(0), p(7), p(14), p(21)]);
    expect(i[0].title).toMatch(/remained stable/);
  });
  it("volume spikes need 3 prior weeks and a large, absolute jump", () => {
    const weeks = [
      { week: "2026-09-28", sets: { side_delts: 8 } },
      { week: "2026-10-05", sets: { side_delts: 8 } },
      { week: "2026-10-12", sets: { side_delts: 8 } },
      { week: "2026-10-19", sets: { side_delts: 14 } },
      { week: "2026-10-26", sets: { side_delts: 2 } },
    ];
    expect(volumeInsights(weeks, "2026-10-26")[0].key).toBe("volume:side_delts:2026-10-19");
    expect(volumeInsights(weeks.slice(1), "2026-10-26")).toEqual([]);
  });
  it("weekStart is Monday", () => {
    expect(weekStart(new Date(2026, 9, 25))).toBe("2026-10-19"); // Sunday → previous Monday
  });
});
