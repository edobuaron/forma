import { describe, expect, it } from "vitest";
import { compareSet, previousCounterpart } from "../comparison";
import { ex, set } from "./helpers";

describe("compareSet", () => {
  const e = ex();
  it("+1 rep at the same weight", () => {
    expect(compareSet(set(60, 10), set(60, 9), e)).toMatchObject({ status: "improved", repDelta: 1, basis: "same_load" });
  });
  it("+2.5 kg with the same reps", () => {
    expect(compareSet(set(62.5, 8), set(60, 8), e)).toMatchObject({ status: "improved", loadDeltaKg: 2.5, basis: "same_reps" });
  });
  it("matched", () => {
    expect(compareSet(set(60, 8), set(60, 8), e).status).toBe("matched");
  });
  it("lower", () => {
    expect(compareSet(set(60, 7), set(60, 8), e).status).toBe("below");
    expect(compareSet(set(57.5, 7), set(60, 8), e).status).toBe("below");
  });
  it("uses e1RM when load up / reps down, for eligible lifts (60×10 → 62.5×8 is not called worse)", () => {
    // 60×10 → 80.0, 62.5×8 → 79.2: within ~1% → matched, not 'below'
    const r = compareSet(set(62.5, 8), set(60, 10), e);
    expect(r.basis).toBe("e1rm");
    expect(r.status).toBe("matched");
    expect(compareSet(set(65, 9), set(60, 10), e).status).toBe("improved");
  });
  it("a planned load increase with fewer reps is never reported as 'below'", () => {
    // 60×10 → 62.5×6: Epley says lower, but this is the expected first session at a new load
    expect(compareSet(set(62.5, 6), set(60, 10), e).status).toBe("not_comparable");
  });
  it("refuses to judge opposite moves on non-eligible exercises", () => {
    const lat = ex({ e1rmEligible: false, category: "isolation" });
    expect(compareSet(set(10, 12), set(7.5, 15), lat).status).toBe("not_comparable");
  });
  it("refuses e1RM beyond 12 reps", () => {
    expect(compareSet(set(62.5, 13), set(60, 15), e).status).toBe("not_comparable");
  });
  it("assisted: less assistance at same reps is an improvement", () => {
    const mu = ex({ loadType: "assisted", e1rmEligible: false, category: "skill" });
    const r = compareSet(set(null, 3, { assistanceKg: 10 }), set(null, 3, { assistanceKg: 15 }), mu);
    expect(r).toMatchObject({ status: "improved", loadDeltaKg: 5 });
  });
  it("ignores warm-ups and incomplete sets", () => {
    expect(compareSet(set(60, 10), set(40, 10, { kind: "warmup" }), e).status).toBe("no_previous");
    expect(compareSet(set(60, 10), set(60, 9, { completed: false }), e).status).toBe("no_previous");
    expect(compareSet(set(60, null), set(60, 9), e).status).toBe("no_previous");
  });
});

describe("previousCounterpart", () => {
  it("pairs by working-set index, skipping warm-ups; missing sets → null", () => {
    const prev = [set(40, 10, { kind: "warmup" }), set(60, 10), set(60, 9)];
    expect(previousCounterpart(prev, 0)?.reps).toBe(10);
    expect(previousCounterpart(prev, 1)?.reps).toBe(9);
    expect(previousCounterpart(prev, 2)).toBeNull();
  });
});
