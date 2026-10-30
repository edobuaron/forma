import { describe, expect, it } from "vitest";
import { chooseNext } from "../next-workout";

const T = (id: string, lastDone: string | null) => ({ id, lastDone });
const program = [T("push", "2026-10-26"), T("pull", "2026-10-28"), T("lower", "2026-10-23"), T("upper", "2026-10-25")];

describe("chooseNext", () => {
  it("continues an established rotation in program order", () => {
    // newest first: pull ← push ← upper ← lower
    const r = chooseNext(program, ["pull", "push", "upper", "lower", "pull"]);
    expect(r).toEqual({ template: program[2], basis: "rotation" });
  });

  it("wraps around the end of the program", () => {
    const r = chooseNext(program, ["upper", "lower", "pull", "push"]);
    expect(r?.template.id).toBe("push");
    expect(r?.basis).toBe("rotation");
  });

  it("falls back to the least recently completed workout when the order is broken", () => {
    const r = chooseNext(program, ["pull", "lower", "push", "upper"]);
    expect(r).toEqual({ template: program[2], basis: "suggested" });
  });

  it("treats a free-form session inside the window as no rotation", () => {
    expect(chooseNext(program, ["pull", null, "push", "upper"])?.basis).toBe("suggested");
  });

  it("needs a full cycle of history before calling it a rotation", () => {
    expect(chooseNext(program, ["pull", "push"])?.basis).toBe("suggested");
  });

  it("puts never-done workouts first, in program order", () => {
    const fresh = [T("a", null), T("b", null), T("c", "2026-10-01")];
    expect(chooseNext(fresh, [])).toEqual({ template: fresh[0], basis: "suggested" });
  });

  it("a single-workout program is always a suggestion", () => {
    expect(chooseNext([T("only", "2026-10-01")], ["only", "only"])?.basis).toBe("suggested");
  });

  it("returns null without workouts", () => {
    expect(chooseNext([], [])).toBeNull();
  });
});
