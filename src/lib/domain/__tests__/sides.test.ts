import { describe, expect, it } from "vitest";
import { sessionPoints, weeklySetsPerMuscle } from "../analytics";
import { compareStreams } from "../comparison";
import { headline, recommendFor } from "../progression";
import { detectRecords } from "../prs";
import { reconcileSides } from "../set-validation";
import {
  attachmentsCompatible, doneWorkingSets, performedSets, sessionMode, setCredit, setDone, setHasData, setPerformed, setVolumeKg,
  sideTrackingSuitable,
} from "../sides";
import type { AttachmentRef, LoggedSet, SideLog } from "../types";
import { ex, perf, rx, set } from "./helpers";

const side = (weightKg: number | null, reps: number | null, o: Partial<SideLog> = {}): SideLog => ({
  weightKg, reps, assistanceKg: null, rir: null, completed: reps != null, ...o,
});
const missing = (): SideLog => ({ weightKg: null, reps: null, assistanceKg: null, rir: null, completed: false });
/** A planned set with left and right recorded separately. */
const pair = (l: SideLog, r: SideLog, o: Partial<LoggedSet> = {}): LoggedSet => ({
  kind: "working", weightKg: null, assistanceKg: null, reps: null, rir: null,
  completed: l.completed || r.completed, sides: { left: l, right: r }, ...o,
});
const pairs = (lw: number, lr: number[], rw: number, rr: number[]) => lr.map((r, i) => pair(side(lw, r), side(rw, rr[i])));

const row = ex({ name: "Single-arm cable row", e1rmEligible: false });
const rope: AttachmentRef = { state: "attachment", id: "rope", name: "Rope" };
const vHandle: AttachmentRef = { state: "attachment", id: "v", name: "V-handle" };

describe("counting", () => {
  it("one left/right pair is one planned set, done only when both sides are", () => {
    const sets = [pair(side(20, 10), side(20, 10)), pair(side(20, 10), missing()), set(20, 10)];
    expect(sets.map(setDone)).toEqual([true, false, true]);
    expect(sets.map(setPerformed)).toEqual([true, true, true]);
    expect(doneWorkingSets(sets)).toBe(2);
  });
  it("muscle-group counts credit a pair once and a half-done pair by half", () => {
    const sets = [pair(side(20, 10), side(20, 10)), pair(side(20, 10), missing())];
    expect(sets.map(setCredit)).toEqual([1, 0.5]);
    const weeks = weeklySetsPerMuscle(sets.map((s) => ({ date: "2026-10-26T10:00:00Z", primary: ["lats"], secondary: ["biceps"], credit: setCredit(s) })));
    const m = [...weeks.values()][0];
    expect(m.get("lats")).toBe(1.5);
    expect(m.get("biceps")).toBe(0.75);
  });
  it("a missing side is never zero: it contributes no reps, no volume and no set", () => {
    const s = pair(side(25, 10), missing());
    expect(setVolumeKg(s, row)).toBe(250);
    expect(performedSets([s], row)).toHaveLength(1);
  });
});

describe("volume", () => {
  it("unequal sides add up their own work, never an average", () => {
    const s = pair(side(25, 10), side(22.5, 8));
    expect(setVolumeKg(s, row)).toBe(25 * 10 + 22.5 * 8);
  });
  it("shared-value history keeps the value as logged", () => {
    expect(setVolumeKg(set(20, 10), ex({ name: "DB curl" }))).toBe(200);
  });
  it("session points use actual side sets and mark the mode", () => {
    const [p] = sessionPoints(row, [perf(pairs(25, [10, 9], 22.5, [8, 8]))]);
    expect(p.topLoadKg).toBe(25);
    expect(p.repsAtTop).toBe(10);
    expect(p.totalReps).toBe(35);
    expect(p.workingSets).toBe(2);
    expect(p.volumeKg).toBe(Math.round(25 * 19 + 22.5 * 16));
    expect(p.mode).toBe("sides");
  });
});

describe("comparison", () => {
  it("compares each side with the same side, never across sides or with sets logged together", () => {
    const history = [perf(pairs(20, [10, 10], 17.5, [8, 8]), 7), perf([set(30, 10), set(30, 10)], 14)];
    const cmps = compareStreams(pairs(20, [11, 10], 17.5, [9, 7]), history, row);
    expect(cmps.filter((c) => c.stream === "together")).toHaveLength(0);
    const l = cmps.filter((c) => c.stream === "left").map((c) => c.comparison.repDelta);
    const r = cmps.filter((c) => c.stream === "right").map((c) => c.comparison.repDelta);
    expect(l).toEqual([1, 0]);
    expect(r).toEqual([1, -1]);
  });
  it("sets logged together don't compare with an earlier session that recorded sides", () => {
    const cmps = compareStreams([set(20, 10)], [perf(pairs(20, [10], 20, [10]))], row);
    expect(cmps).toHaveLength(1);
    expect(cmps[0].comparison.status).toBe("no_previous");
  });
});

describe("progression with sides", () => {
  const p = rx({ sets: 2, repMin: 8, repMax: 12 });
  const sidesCtx = { sides: true };

  it("suggests a shared increase only when both sides earned it", () => {
    const r = recommendFor(row, p, [perf(pairs(20, [12, 12], 20, [12, 12]))], sidesCtx);
    expect(r.action).toBe("increase_load");
    expect(r.targetLoadKg).toBe(22.5);
    expect(r.sides!.left.targetLoadKg).toBe(22.5);
    expect(headline(r, row, "kg")).toBe("Both sides achieved all target reps. Consider 22.5 kg each side today.");
  });

  it("holds both sides when only one side is ready", () => {
    const r = recommendFor(row, p, [perf(pairs(20, [12, 12], 20, [12, 10]))], sidesCtx);
    expect(r.action).toBe("hold_sides");
    expect(r.sides!.left.targetLoadKg).toBe(20);
    expect(r.sides!.right.targetLoadKg).toBe(20);
    expect(r.sides!.right.targetReps).toEqual([12, 11]);
    expect(r.reasons.join(" ")).toMatch(/needs evidence from both sides/);
  });

  it("keeps each side's own load when the sides differ", () => {
    const r = recommendFor(row, p, [perf(pairs(20, [10, 10], 17.5, [9, 8]))], sidesCtx);
    expect(r.action).toBe("hold_build_reps");
    expect(r.sides!.left.targetLoadKg).toBe(20);
    expect(r.sides!.right.targetLoadKg).toBe(17.5);
    expect(headline(r, row, "kg")).toBe("Keep L 20 kg · R 17.5 kg. Aim L 11 / 11 · R 10 / 9.");
  });

  it("an incomplete side follows the shortened-workout rules and blocks an increase", () => {
    const sets = [pair(side(20, 12), side(20, 12)), pair(side(20, 12), missing())];
    const r = recommendFor(row, p, [perf(sets, 0, { shortfallReason: "time" })], sidesCtx);
    expect(r.action).toBe("hold_shortened");
    expect(r.sides!.right.action).toBe("hold_shortened");
    // The left side earned more load, but it is held with the right: prefill never jumps one side ahead.
    expect(r.sides!.left.action).toBe("hold_sides");
    expect(r.sides!.left.targetLoadKg).toBe(20);
    expect(r.targetLoadKg).toBe(20); // both sides keep 20 kg
  });

  it("an incomplete side without a reason never reads as a decline", () => {
    const sets = [pair(side(20, 12), missing()), pair(side(20, 12), missing())];
    const r = recommendFor(row, p, [perf(sets)], sidesCtx);
    expect(r.action).toBe("hold_incomplete");
  });

  it("the first session with sides starts from the last shared load without increasing it", () => {
    const r = recommendFor(row, p, [perf([set(20, 12), set(20, 12)])], sidesCtx);
    expect(r.action).toBe("sides_baseline");
    expect(r.sides!.left.targetLoadKg).toBe(20);
    expect(r.sides!.right.targetLoadKg).toBe(20);
  });

  it("logging together again ignores side history instead of reinterpreting it", () => {
    const r = recommendFor(row, p, [perf(pairs(20, [12, 12], 20, [12, 12]))], { sides: false });
    expect(r.action).toBe("first_time");
    expect(r.reasons.join(" ")).toMatch(/recorded left and right separately/);
  });

  it("skill work is never load-progressed, with or without sides", () => {
    const skill = ex({ progression: "skill", category: "skill", name: "Muscle-up" });
    const r = recommendFor(skill, p, [perf(pairs(0, [5, 5], 0, [5, 5]))], sidesCtx);
    expect(r.action).toBe("skill");
  });
});

describe("attachments", () => {
  const p = rx({ sets: 2, repMin: 8, repMax: 12 });
  it("a different known attachment is not evidence for progression", () => {
    const curl = ex({ name: "Cable curl", e1rmEligible: false });
    const r = recommendFor(curl, p, [perf([set(20, 12), set(20, 12)], 0, { attachment: vHandle })], { sides: false, attachment: rope });
    expect(r.action).toBe("first_time");
    expect(r.reasons.join(" ")).toMatch(/different attachment/);
  });
  it("the same attachment, no attachment and not-recorded rules", () => {
    expect(attachmentsCompatible(rope, { ...rope, name: "Renamed rope" })).toBe(true);
    expect(attachmentsCompatible(rope, vHandle)).toBe(false);
    expect(attachmentsCompatible(rope, { state: "none", id: null, name: null })).toBe(false);
    expect(attachmentsCompatible({ state: "none", id: null, name: null }, { state: "none", id: null, name: null })).toBe(true);
    expect(attachmentsCompatible(null, rope)).toBe(true);
  });
});

describe("records per side", () => {
  it("a left-arm best never counts against the right arm", () => {
    const hist = pairs(20, [10], 17.5, [10]);
    const recs = detectRecords(row, pairs(20, [10], 20, [8]), hist);
    expect(recs).toEqual([expect.objectContaining({ side: "right", type: "heaviest_load", loadKg: 20 })]);
  });
  it("sets logged together keep their own records", () => {
    const recs = detectRecords(row, [set(25, 10)], [...pairs(30, [10], 30, [10]), set(20, 10)]);
    expect(recs.map((r) => [r.side, r.type])).toEqual([[null, "heaviest_load"]]);
  });
});

describe("mode switching and validation", () => {
  it("knows which sets hold data, so a mode switch can leave them alone", () => {
    expect(setHasData(pair(missing(), missing()))).toBe(false);
    expect(setHasData(pair(missing(), side(20, null, { completed: false })))).toBe(true);
    expect(setHasData(set(null, null, { completed: false }))).toBe(false);
    expect(sessionMode([set(20, 10), pair(side(20, 10), missing())])).toBe("mixed");
  });
  it("clearing a performed side's reps un-completes only that side", () => {
    const base = {
      sided: true, completed: true, completed_at: "t",
      left_weight_kg: 20, left_assistance_kg: null, left_reps: null, left_rir: null, left_completed: true, left_completed_at: "t",
      right_weight_kg: 20, right_assistance_kg: null, right_reps: 8, right_rir: null, right_completed: true, right_completed_at: "t",
    };
    const r = reconcileSides(base, "external");
    expect(r.left_completed).toBe(false);
    expect(r.right_completed).toBe(true);
    expect(r.completed).toBe(true);
    const none = reconcileSides({ ...base, right_reps: null }, "external");
    expect(none.completed).toBe(false);
    expect(none.completed_at).toBe(null);
  });
  it("offers side tracking only where it fits", () => {
    expect(sideTrackingSuitable({ name: "Lat pulldown", equipment: "cable", category: "compound" })).toBe(true);
    expect(sideTrackingSuitable({ name: "Bulgarian split squat", equipment: "smith", category: "compound" })).toBe(true);
    expect(sideTrackingSuitable({ name: "Bench press", equipment: "barbell", category: "compound", weight_convention: "total" })).toBe(false);
    expect(sideTrackingSuitable({ name: "Muscle-up", equipment: "bodyweight", category: "skill" })).toBe(false);
  });
});
