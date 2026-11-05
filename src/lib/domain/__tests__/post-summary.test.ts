import { describe, expect, it } from "vitest";
import { exerciseLine, shareVolumeKg, workingSetCount } from "../post-summary";

describe("shared workout summaries", () => {
  it("collapses identical sets", () => {
    expect(exerciseLine([{ kg: 80, reps: 8 }, { kg: 80, reps: 8 }, { kg: 80, reps: 8 }], "kg")).toBe("3 × 8 · 80 kg");
  });
  it("lists varied sets in order", () => {
    expect(exerciseLine([{ kg: 80, reps: 8 }, { kg: 80, reps: 7 }, { kg: 75, reps: 6 }], "kg")).toBe("80×8, 80×7, 75×6 kg");
  });
  it("respects hidden loads or reps", () => {
    expect(exerciseLine([{ reps: 8 }, { reps: 7 }], "kg")).toBe("8, 7 reps");
    expect(exerciseLine([{ reps: 10 }, { reps: 10 }], "kg")).toBe("2 × 10");
    expect(exerciseLine([{}, {}], "kg")).toBe("2 sets");
    expect(exerciseLine([{ kg: 100 }, { kg: 100 }], "kg")).toBe("2 sets · 100 kg");
  });
  it("shows left and right separately", () => {
    expect(exerciseLine([{ left: { kg: 20, reps: 10 }, right: { kg: 20, reps: 9 } }], "kg")).toBe("L 20×10 · R 20×9");
  });
  it("converts to the viewer's unit", () => {
    expect(exerciseLine([{ kg: 100, reps: 5 }], "lb")).toBe("1 × 5 · 220.5 lb");
  });
  it("volume only when it means something", () => {
    expect(shareVolumeKg([{ name: "Bench", sets: [{ kg: 80, reps: 8 }, { kg: 80, reps: 7 }] }])).toBe(1200);
    expect(shareVolumeKg([{ name: "DB press", convention: "per_dumbbell", sets: [{ kg: 30, reps: 8 }] }])).toBeNull();
    expect(shareVolumeKg([{ name: "Bench", sets: [{ reps: 8 }] }])).toBeNull();
    expect(shareVolumeKg([{ name: "Assisted pull-up", sets: [{ assist_kg: 20, reps: 8 }] }])).toBeNull();
    expect(workingSetCount([{ name: "a", sets: [{}, {}] }, { name: "b", sets: [{}] }])).toBe(3);
  });
});
