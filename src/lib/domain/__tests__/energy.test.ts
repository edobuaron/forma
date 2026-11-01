import { describe, expect, it } from "vitest";
import { ENERGY_LEVELS, energyLabel, energyPosition, energySummary, isEnergyRating } from "../energy";

describe("energy rating", () => {
  it("covers 1 to 10 with the requested endpoint labels", () => {
    expect(ENERGY_LEVELS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(energyLabel(1)).toBe("Exhausted");
    expect(energyLabel(10)).toBe("Full of energy");
    expect(new Set(ENERGY_LEVELS.map(energyLabel)).size).toBe(10);
  });

  it("accepts only whole numbers in range", () => {
    for (const v of [0, 11, 5.5, -1, NaN, null, undefined, "7"]) expect(isEnergyRating(v)).toBe(false);
    expect(() => energyLabel(0)).toThrow(RangeError);
  });

  it("treats a missing or skipped rating as not answered, never as a value", () => {
    expect(energySummary(null)).toBeNull();
    expect(energySummary(undefined)).toBeNull();
    expect(energySummary(7)).toBe("7/10 · Good");
  });

  it("places ratings evenly along the scale", () => {
    expect(energyPosition(1)).toBe(0);
    expect(energyPosition(10)).toBe(1);
  });
});
