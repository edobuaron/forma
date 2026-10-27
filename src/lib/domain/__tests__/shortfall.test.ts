import { describe, expect, it } from "vitest";
import { isShortOfPlan } from "../shortfall";

describe("isShortOfPlan", () => {
  it("only exercises with fewer completed sets than prescribed", () => {
    expect(isShortOfPlan({ sets: 3 }, 1)).toBe(true);
    expect(isShortOfPlan({ sets: 3 }, 3)).toBe(false);
    expect(isShortOfPlan({ sets: 3 }, 4)).toBe(false);
  });
  it("ignores optional exercises and exercises without a plan", () => {
    expect(isShortOfPlan({ sets: 3, optional: true }, 0)).toBe(false);
    expect(isShortOfPlan({}, 0)).toBe(false);
  });
});
