import { describe, expect, it } from "vitest";
import {
  averagePace, displayToMetres, formatDistance, formatPace, metresToDisplay, normalizePlan, paceSeconds, parseDurationInput, planProblem,
  planText, runProblem, runTotals, totalsText,
} from "../running";

describe("units", () => {
  it("converts km and miles both ways, stored as metres", () => {
    expect(displayToMetres(5, "km")).toBe(5000);
    expect(displayToMetres(3.1, "mi")).toBeCloseTo(4988.97, 1);
    expect(metresToDisplay(5000, "mi")).toBe(3.11);
    expect(metresToDisplay(10000, "km")).toBe(10);
  });
  it("formats short km-mode distances in metres and miles in miles", () => {
    expect(formatDistance(400, "km")).toBe("400 m");
    expect(formatDistance(5200, "km")).toBe("5.2 km");
    expect(formatDistance(1609.344, "mi")).toBe("1 mi");
    expect(formatDistance(null, "km")).toBe("—");
  });
});

describe("duration input", () => {
  it("reads minutes, mm:ss and h:mm:ss", () => {
    expect(parseDurationInput("25")).toBe(1500);
    expect(parseDurationInput("25:30")).toBe(1530);
    expect(parseDurationInput("1:05:00")).toBe(3900);
    expect(parseDurationInput("25'30")).toBe(1530);
    expect(parseDurationInput("")).toBeNull();
  });
  it("refuses nonsense and more than 24 hours", () => {
    expect(parseDurationInput("abc")).toBe("invalid");
    expect(parseDurationInput("25:75")).toBe("invalid");
    expect(parseDurationInput("1441")).toBe("invalid");
  });
});

describe("pace", () => {
  it("exists only with a valid distance and duration", () => {
    expect(paceSeconds(1500, 5000, "km")).toBe(300);
    expect(formatPace(paceSeconds(1500, 5000, "km"), "km")).toBe("5:00 /km");
    expect(formatPace(paceSeconds(1500, 5000, "mi"), "mi")).toBe("8:03 /mi");
    expect(paceSeconds(1500, null, "km")).toBeNull();
    expect(paceSeconds(null, 5000, "km")).toBeNull();
    expect(formatPace(null, "km")).toBeNull();
  });
  it("gives no pace for an impossible speed", () => {
    expect(paceSeconds(600, 10000, "km")).toBeNull(); // 10 km in 10 min
  });
});

describe("validation", () => {
  it("needs a time; distance optional; impossible speeds refused", () => {
    expect(runProblem({ duration_s: null, distance_m: 5000, effort: null, intervals_done: null })).toMatch(/how long/);
    expect(runProblem({ duration_s: 1800, distance_m: null, effort: null, intervals_done: null })).toBeNull();
    expect(runProblem({ duration_s: 600, distance_m: 10000, effort: null, intervals_done: null })).toMatch(/faster than anyone/);
    expect(runProblem({ duration_s: 1800, distance_m: null, effort: 11, intervals_done: null })).toMatch(/Effort/);
  });
  it("checks plans by kind and keeps only that kind's fields", () => {
    expect(planProblem({ target_kind: "time" })).toMatch(/time/);
    expect(planProblem({ target_kind: "intervals", interval_count: 6, interval_work_m: 400, interval_work_s: 90 })).toMatch(/either/);
    expect(planProblem({ target_kind: "intervals", interval_count: 6, interval_work_m: 400, interval_recovery_s: 90 })).toBeNull();
    expect(normalizePlan({ target_kind: "distance", target_distance_m: 5000, target_duration_s: 1800 })).toMatchObject({ target_distance_m: 5000, target_duration_s: null });
  });
});

describe("plan text", () => {
  it("describes targets without mixing them with results", () => {
    expect(planText({ target_kind: "time", target_duration_s: 1800 }, "km")).toBe("30 min");
    expect(planText({ target_kind: "distance", target_distance_m: 5000 }, "mi")).toBe("3.11 mi");
    expect(planText({ target_kind: "intervals", interval_count: 6, interval_work_m: 400, interval_recovery_s: 90 }, "km")).toBe("6 × 400 m · 1:30 recovery");
    expect(planText({ target_kind: "intervals", interval_count: 8, interval_work_s: 60, interval_recovery_s: 60 }, "km")).toBe("8 × 1 min · 1 min recovery");
    expect(planText({ target_kind: "open" }, "km")).toBeNull();
  });
});

describe("totals", () => {
  const runs = [
    { completed: true, duration_s: 1500, distance_m: 5000 },
    { completed: true, duration_s: 1800, distance_m: null }, // no distance: time only
    { completed: false, duration_s: 900, distance_m: 3000 }, // not done: ignored
  ];
  it("adds time from every completed run and distance only where recorded", () => {
    const t = runTotals(runs);
    expect(t).toMatchObject({ runs: 2, durationS: 3300, distanceM: 5000, runsWithDistance: 1, durationWithDistanceS: 1500 });
    expect(averagePace(t, "km")).toBe(300);
    expect(totalsText(t, "km")).toBe("2 runs · 5 km (1 of 2 with distance) · 55:00");
  });
  it("never invents a distance", () => {
    const t = runTotals([{ duration_s: 1800, distance_m: null }]);
    expect(t.distanceM).toBe(0);
    expect(averagePace(t, "km")).toBeNull();
    expect(totalsText(t, "km")).toBe("1 run · 30:00");
  });
});
