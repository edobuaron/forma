import { describe, expect, it } from "vitest";
import { sessionPoints } from "../analytics";
import { compareStreams } from "../comparison";
import { dropSegmentsDone, dropVolumeKg, volumeBreakdown, warmupsDone } from "../drops";
import { epley } from "../e1rm";
import { recommendFor } from "../progression";
import { detectPRs, detectRecords } from "../prs";
import { doneWorkingSets, setVolumeKg } from "../sides";
import type { LoggedSet, SideLog } from "../types";
import { ex, perf, rx, set } from "./helpers";

const drop = (w: number | null, r: number | null, o: Partial<LoggedSet> = {}) => set(w, r, { kind: "drop", ...o });
const warm = (w: number, r: number) => set(w, r, { kind: "warmup" });
const side = (weightKg: number | null, reps: number | null, completed = reps != null): SideLog => ({ weightKg, reps, assistanceKg: null, rir: null, completed });
const sidedSet = (kind: LoggedSet["kind"], l: SideLog, r: SideLog): LoggedSet => ({
  kind, weightKg: null, assistanceKg: null, reps: null, rir: null, completed: l.completed || r.completed, sides: { left: l, right: r },
});

const lateral = ex({ name: "Cable lateral raise", category: "isolation", e1rmEligible: false });
const ctx = { sides: false, attachment: null };

describe("warm-ups", () => {
  it("never count toward planned-set completion or working volume", () => {
    const sets = [warm(5, 15), warm(7.5, 10), set(10, 12), set(10, 12)];
    expect(doneWorkingSets(sets)).toBe(2);
    expect(volumeBreakdown(sets, lateral)).toEqual({ workingKg: 240, dropKg: 0, totalKg: 240 });
    expect(warmupsDone(sets)).toBe(2);
  });
  it("are never compared, and never make a record or a progression case", () => {
    const history = [perf([set(10, 12), set(10, 12)], 7)];
    // A heavy warm-up must not read as a heavier set, a record or progress.
    const today = [warm(15, 12), set(10, 12), set(10, 12)];
    expect(compareStreams(today, history, lateral).map((c) => c.comparison.status)).toEqual(["matched", "matched"]);
    expect(detectPRs(lateral, today, history[0].sets)).toEqual([]);
    const r = recommendFor(lateral, rx({ sets: 2, repMin: 10, repMax: 15 }), [perf([warm(10, 15), warm(10, 15), set(10, 12), set(10, 12)])], ctx);
    expect(r.targetLoadKg).toBe(10);
  });
});

describe("drop sets", () => {
  // Set 1, set 2 with two drops (15 × 10 → 10 × 8 → 7.5 × 6), set 3.
  const sets = [set(15, 12), set(15, 10), drop(10, 8), drop(7.5, 6), set(15, 9)];

  it("count as one planned set, with drops reported separately", () => {
    expect(doneWorkingSets(sets)).toBe(3);
    expect(dropSegmentsDone(sets)).toBe(2);
    expect(dropSegmentsDone([...sets, drop(5, null, { completed: false })])).toBe(2);
  });

  it("add drop work to labelled total volume once, never to working volume", () => {
    const v = volumeBreakdown(sets, lateral);
    expect(v.workingKg).toBe(15 * 12 + 15 * 10 + 15 * 9);
    expect(v.dropKg).toBe(10 * 8 + 7.5 * 6);
    expect(v.totalKg).toBe(v.workingKg + v.dropKg);
    // The per-set working helper ignores drops entirely: no double count through either path.
    expect(sets.reduce((a, s) => a + setVolumeKg(s, lateral), 0)).toBe(v.workingKg);
    // Unfinished or load-less drops are not volume.
    expect(dropVolumeKg(drop(10, 8, { completed: false }), lateral)).toBe(0);
    expect(dropVolumeKg(drop(null, 8), lateral)).toBe(0);
  });

  it("keep left and right apart, and never count an unperformed side", () => {
    const d = sidedSet("drop", side(10, 8), side(null, null, false));
    expect(dropVolumeKg(d, lateral)).toBe(80);
    expect(dropSegmentsDone([d])).toBe(1);
    const both = sidedSet("drop", side(10, 8), side(7.5, 8));
    expect(volumeBreakdown([sidedSet("working", side(15, 10), side(15, 10)), both], lateral)).toEqual({ workingKg: 300, dropKg: 140, totalKg: 440 });
  });

  it("are never compared with straight sets, and the next working set pairs with the right one", () => {
    const history = [perf([set(15, 12), set(15, 10), set(15, 9)], 7)];
    const cmps = compareStreams(sets, history, lateral);
    expect(cmps).toHaveLength(3);
    expect(cmps.map((c) => [c.set.weightKg, c.previous?.weightKg, c.comparison.status])).toEqual([[15, 15, "matched"], [15, 15, "matched"], [15, 15, "matched"]]);
  });

  it("drop reps never satisfy straight-set progression", () => {
    // Top of range is 15. The working sets reached 12/10/9; the drops add reps, which must not count.
    const p = rx({ sets: 3, repMin: 10, repMax: 15 });
    const many = [set(15, 12), set(15, 10), drop(10, 15), drop(7.5, 15), drop(5, 15), set(15, 9)];
    const r = recommendFor(lateral, p, [perf(many)], ctx);
    expect(r.targetLoadKg).toBe(15);
    expect(r.action).not.toBe("increase_load");
    const withoutDrops = recommendFor(lateral, p, [perf([set(15, 12), set(15, 10), set(15, 9)])], ctx);
    expect(r.targetReps).toEqual(withoutDrops.targetReps);
  });

  it("never create records, even when a drop has more reps or a lighter load than anything before", () => {
    const press = ex();
    const history = [set(60, 8), set(60, 8)];
    expect(detectPRs(press, [set(60, 8), drop(40, 20), drop(80, 1)], history)).toEqual([]);
    expect(detectRecords(press, [set(60, 8), drop(40, 20)], history)).toEqual([]);
    expect(epley(40, 20)).toBeNull();
  });

  it("stay out of session charts' working-set figures", () => {
    const [p] = sessionPoints(lateral, [perf(sets)]);
    expect(p.workingSets).toBe(3);
    expect(p.volumeKg).toBe(15 * 12 + 15 * 10 + 15 * 9);
  });
});
