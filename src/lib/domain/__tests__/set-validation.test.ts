import { describe, expect, it } from "vitest";
import { reconcileCompletion, setProblem } from "../set-validation";
const done = { completed: true, completed_at: "2026-10-26T10:00:00Z", reps: 8, weight_kg: 20, assistance_kg: 10 };
describe("editing completed sets", () => {
  it("clearing required fields uncompletes a set", () => {
    expect(reconcileCompletion({ ...done, assistance_kg: null }, "assisted")).toMatchObject({ completed: false, completed_at: null });
    expect(reconcileCompletion({ ...done, weight_kg: null }, "external").completed).toBe(false);
    expect(reconcileCompletion({ ...done, reps: null }, "bodyweight").completed).toBe(false);
    expect(reconcileCompletion({ ...done, reps: 0 }, "external").completed).toBe(false);
  });
  it("preserves explicit zero assistance and valid edits", () => {
    expect(reconcileCompletion({ ...done, assistance_kg: 0 }, "assisted").completed).toBe(true);
    expect(setProblem({ ...done, weight_kg: null }, "bodyweight")).toBeNull();
    expect(setProblem({ ...done, assistance_kg: null }, "assisted")).not.toBeNull();
  });
});
