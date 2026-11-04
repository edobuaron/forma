import { describe, expect, it } from "vitest";
import { comparisonSummaryText, comparisonText } from "@/components/workout/format";
import { compareStreams, counterpart, summariseComparison, workingPositions } from "../comparison";
import { exerciseInsights } from "../insights";
import { recommend, recommendFor } from "../progression";
import type { LoggedSet, SideLog } from "../types";
import { ex, perf, rx, set } from "./helpers";

const e = ex({ name: "Pec Deck", category: "isolation", e1rmEligible: false });
const side = (weightKg: number | null, reps: number | null, completed = true): SideLog => ({ weightKg, assistanceKg: null, reps, rir: null, completed });
const pair = (l: SideLog, r: SideLog, o: Partial<LoggedSet> = {}): LoggedSet =>
  set(null, null, { sides: { left: l, right: r }, completed: l.completed || r.completed, ...o });
const texts = (cur: LoggedSet[], history: ReturnType<typeof perf>[]) =>
  compareStreams(cur, history, e).map((c) => `${c.stream}${c.index + 1}: ${comparisonText(c.comparison, "kg", e.loadType)?.text ?? "-"}`);

describe("two → three sets", () => {
  const last = perf([set(60, 10), set(60, 9)], 7);
  const today = [set(60, 10), set(60, 10), set(52.5, 8)];

  it("the extra third set is labelled, never compared with the previous final set", () => {
    expect(texts(today, [last])).toEqual(["together1: Matched", "together2: +1 rep", "together3: Extra set — no previous comparison"]);
    const c = counterpart(last.sets, 2, e);
    expect(c).toEqual({ previous: null, extra: true });
  });

  it("separates matched sets from additional work and shows real volume with set counts", () => {
    const items = compareStreams(today, [last], e);
    const sum = summariseComparison(items, today, [last], e);
    expect(sum).toMatchObject({ comparable: 2, extra: 1, fewer: 0, current: { sets: 3, volumeKg: 1620 }, previous: { sets: 2, volumeKg: 1140 } });
    expect(comparisonSummaryText(sum, "kg")).toEqual({
      sets: "2 comparable sets · 1 extra set",
      volume: "Volume 1,620 kg over 3 sets · last time 1,140 kg over 2 sets",
    });
    // No "below" verdict anywhere: the lighter extra set is additional work, not regression.
    expect(items.some((c) => c.comparison.status === "below")).toBe(false);
  });

  it("extra accumulated reps don't earn a load increase, and the extra set isn't held against progression", () => {
    const two = rx({ sets: 2, repMin: 8, repMax: 12 });
    const r = recommend(e, two, [perf([set(60, 12), set(60, 11), set(52.5, 8)], 0, { prescription: two }), perf([set(60, 12), set(60, 10)], 7, { prescription: two })]);
    expect(r.action).toBe("hold_build_reps");
    expect(r.targetLoadKg).toBe(60);
    expect(r.targetReps).toEqual([12, 12]);
    expect(r.reasons.join(" ")).toMatch(/1 extra set beyond the 2 planned/);
    // Planned sets at the top → increase, whatever the extra set did.
    const up = recommend(e, two, [perf([set(60, 12), set(60, 12), set(50, 6)], 0, { prescription: two })]);
    expect(up.action).toBe("increase_load");
  });

  it("an extra set at the same load with fewer reps doesn't trigger 'below previous'", () => {
    const two = rx({ sets: 2, repMin: 8, repMax: 12 });
    const r = recommend(e, two, [perf([set(60, 11), set(60, 10), set(60, 6)], 0, { prescription: two }), perf([set(60, 11), set(60, 10)], 7, { prescription: two })]);
    expect(r.action).toBe("hold_build_reps");
  });
});

describe("three → two sets", () => {
  it("compares the two matched sets and reports the missing one, without a verdict on it", () => {
    const last = perf([set(60, 10), set(60, 10), set(60, 9)], 7);
    const today = [set(60, 10), set(60, 10)];
    expect(texts(today, [last])).toEqual(["together1: Matched", "together2: Matched"]);
    const sum = summariseComparison(compareStreams(today, [last], e), today, [last], e);
    expect(comparisonSummaryText(sum, "kg").sets).toBe("2 comparable sets · 1 set fewer than last time");
  });

  it("totals over unequal set counts never make 'below previous'", () => {
    const two = rx({ sets: 2 });
    const r = recommend(e, two, [perf([set(60, 9), set(60, 9)], 0, { prescription: two }), perf([set(60, 9), set(60, 9), set(60, 9)], 7, { prescription: rx() })]);
    expect(r.action).toBe("hold_build_reps");
  });

  it("a plan cut from three sets to two says so, and doesn't call last time's third set extra", () => {
    const r = recommend(e, rx({ sets: 2 }), [perf([set(60, 9), set(60, 9), set(60, 9)], 0, { prescription: rx() })]);
    expect(r.action).toBe("hold_build_reps");
    expect(r.reasons.join(" ")).toMatch(/The plan now has 2 sets \(last time 3\)/);
    expect(r.reasons.join(" ")).not.toMatch(/extra/);
  });
});

describe("skipped and removed middle sets", () => {
  it("a stored working number keeps a set after a skipped one at its own position", () => {
    // Last time set 2 was skipped: finishing removed it but kept set 3's number.
    const last = perf([set(60, 10, { workingNo: 1 }), set(60, 8, { workingNo: 3 })], 7);
    expect(workingPositions(last.sets).map((p) => p.pos)).toEqual([0, 2]);
    expect(texts([set(60, 10), set(60, 9), set(60, 9)], [last])).toEqual(["together1: Matched", "together2: -", "together3: +1 rep"]);
  });

  it("a skipped set today keeps later sets at their position", () => {
    const last = perf([set(60, 10), set(60, 9), set(60, 8)], 7);
    const today = [set(60, 10), set(60, null, { completed: false }), set(60, 8)];
    expect(texts(today, [last])).toEqual(["together1: Matched", "together3: Matched"]);
    expect(compareStreams(today, [last], e)[1].previous?.reps).toBe(8);
  });

  it("a set without a logged load keeps its place instead of shifting later sets", () => {
    const last = perf([set(60, 10), set(null, 9), set(60, 8)], 7);
    expect(counterpart(last.sets, 1, e)).toEqual({ previous: null, extra: false });
    expect(counterpart(last.sets, 2, e).previous?.reps).toBe(8);
  });

  it("sets removed before finishing are renumbered by order, as the workout showed them", () => {
    const last = perf([set(60, 10), set(60, 8)], 7); // set 2 of 3 removed during the workout
    expect(texts([set(60, 10), set(60, 9)], [last])).toEqual(["together1: Matched", "together2: +1 rep"]);
  });

  it("a skipped planned set isn't made up for by an extra one", () => {
    const r = recommend(e, rx(), [perf([set(60, 10, { workingNo: 1 }), set(60, 10, { workingNo: 3 }), set(60, 10, { workingNo: 4 })], 0, { prescription: rx() })]);
    expect(r.action).toBe("hold_incomplete");
  });
});

describe("warm-ups and drops never shift positions", () => {
  it("pairs working sets only", () => {
    const last = perf([set(30, 12, { kind: "warmup" }), set(60, 10), set(40, 6, { kind: "drop" }), set(60, 9)], 7);
    const today = [set(60, 10), set(30, 10, { kind: "warmup" }), set(60, 9), set(45, 5, { kind: "drop" }), set(50, 8)];
    expect(texts(today, [last])).toEqual(["together1: Matched", "together2: Matched", "together3: Extra set — no previous comparison"]);
  });
});

describe("left/right tracking", () => {
  it("compares each side with the same side by position; a skipped side doesn't shift the other", () => {
    const last = perf([pair(side(20, 10), side(20, 10)), pair(side(20, 9), side(null, null, false)), pair(side(20, 8), side(20, 8))], 7);
    const today = [pair(side(20, 10), side(20, 10)), pair(side(20, 9), side(20, 9)), pair(side(20, 9), side(20, 9)), pair(side(15, 8), side(15, 8))];
    expect(texts(today, [last])).toEqual([
      "left1: Matched", "left2: Matched", "left3: +1 rep", "left4: Extra set — no previous comparison",
      "right1: Matched", "right2: -", "right3: +1 rep", "right4: Extra set — no previous comparison",
    ]);
  });

  it("never compares sets logged together with sides", () => {
    const last = perf([pair(side(20, 10), side(20, 10)), pair(side(20, 9), side(20, 9))], 7);
    expect(texts([set(40, 10), set(40, 10), set(40, 10)], [last])).toEqual(["together1: -", "together2: -", "together3: -"]);
  });

  it("each side's progression ignores its extra sets", () => {
    const two = rx({ sets: 2, repMin: 8, repMax: 12 });
    const last = perf([pair(side(20, 12), side(20, 12)), pair(side(20, 12), side(20, 12)), pair(side(15, 6), side(15, 6))], 0, { prescription: two });
    const r = recommendFor(e, two, [last], { sides: true });
    expect(r.action).toBe("increase_load");
  });
});

describe("attachment changes", () => {
  const cable = ex({ name: "Cable Fly", category: "isolation", e1rmEligible: false });
  const rope = { state: "attachment" as const, id: "rope", name: "Rope" };
  const handle = { state: "attachment" as const, id: "handle", name: "D-handle" };

  it("insights don't compare sessions across an attachment change", () => {
    const h = [
      perf([set(20, 8), set(20, 8)], 0, { attachment: handle }),
      perf([set(20, 10), set(20, 10)], 7, { attachment: rope }),
      perf([set(20, 11), set(20, 11)], 14, { attachment: rope }),
    ];
    expect(exerciseInsights(cable, h).filter((i) => i.key.startsWith("decline"))).toEqual([]);
  });

  it("an extra set in one session doesn't read as a decline", () => {
    const h = [
      perf([set(20, 10), set(20, 10), set(20, 5)], 0),
      perf([set(20, 10), set(20, 10)], 7),
      perf([set(20, 10), set(20, 10)], 14),
    ];
    expect(exerciseInsights(cable, h).some((i) => i.key.startsWith("decline"))).toBe(false);
  });

  it("a real decline on matched sets is still found", () => {
    const h = [
      perf([set(20, 8), set(20, 8), set(20, 8)], 0),
      perf([set(20, 9), set(20, 9)], 7),
      perf([set(20, 10), set(20, 10)], 14),
    ];
    const d = exerciseInsights(cable, h).find((i) => i.key.startsWith("decline"));
    expect(d?.detail).toMatch(/^Reps on the same 2 sets at the same load went 20 → 18 → 16\./);
  });
});

describe("prescription changes", () => {
  it("a rep range that moved past last session's explains it instead of suggesting a load", () => {
    const old = rx({ repMin: 6, repMax: 8 });
    const now = rx({ repMin: 12, repMax: 15 });
    const r = recommend(e, now, [perf([set(80, 8), set(80, 8), set(80, 8)], 0, { prescription: old })]);
    expect(r.action).toBe("prescription_changed");
    expect(r.targetLoadKg).toBeNull();
    expect(r.reasons[0]).toMatch(/The plan changed from 6–8 to 12–15 reps/);
  });
});
