import { describe, expect, it } from "vitest";
import { sessionPoints } from "../analytics";
import { compareSet, previousCounterpart } from "../comparison";
import { recommend } from "../progression";
import { detectPRs } from "../prs";
import { isValidWorkingSet } from "../sets";
import { ex, perf, rx, set } from "./helpers";

// Sets saved before assistance was required can have assistance_kg = null.
// A missing value must never be read as 0 kg of assistance.
const assisted = ex({ name: "Assisted Muscle-Up Transition", category: "skill", loadType: "assisted", e1rmEligible: false, progression: "double_progression", incrementKg: 5 });
const a = (assistanceKg: number | null, reps: number) => set(null, reps, { assistanceKg });

describe("missing assistance", () => {
  it("is not a valid working set, but explicit zero is", () => {
    expect(isValidWorkingSet(a(null, 5), assisted)).toBe(false);
    expect(isValidWorkingSet(a(0, 5), assisted)).toBe(true);
  });

  it("produces no comparison instead of a false 'less assistance' improvement", () => {
    expect(compareSet(a(20, 5), a(null, 5), assisted).status).toBe("no_previous");
    expect(compareSet(a(null, 5), a(20, 5), assisted).status).toBe("no_previous");
    expect(compareSet(a(0, 5), a(10, 5), assisted)).toMatchObject({ status: "improved", basis: "same_reps" });
  });

  it("leaves a gap in set pairing instead of shifting later sets", () => {
    const prev = [a(20, 5), a(null, 4), a(15, 3)];
    expect(previousCounterpart(prev, 1, assisted)).toBeNull();
    expect(previousCounterpart(prev, 2, assisted)?.assistanceKg).toBe(15);
  });

  it("creates no 'least assistance' record from a missing value", () => {
    expect(detectPRs(assisted, [a(null, 5)], [a(20, 5)])).toEqual([]);
    // a missing value in history doesn't count as a 0 kg best either
    const prs = detectPRs(assisted, [a(15, 5)], [a(20, 5), a(null, 5)]);
    expect(prs).toEqual([expect.objectContaining({ type: "least_assistance", value: 15, previous: 20 })]);
  });

  it("is ignored by progression and analytics", () => {
    const history = [perf([a(null, 3), a(null, 3)], 2)];
    expect(recommend(assisted, rx({ sets: 2, repMin: 2, repMax: 3 }), history).action).toBe("first_time");
    expect(sessionPoints(assisted, history)).toEqual([]);
  });
});

describe("missing external weight", () => {
  it("is never read as 0 kg", () => {
    const e = ex();
    expect(compareSet(set(60, 8), set(null, 8), e).status).toBe("no_previous");
    expect(detectPRs(e, [set(null, 12)], [set(60, 8)])).toEqual([]);
  });
});
