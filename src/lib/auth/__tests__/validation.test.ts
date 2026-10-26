import { describe, expect, it } from "vitest";
import { safeRedirect, passwordProblem } from "../validation";
describe("auth destinations", () => {
  it("preserves recovery and internal paths", () => {
    expect(safeRedirect("/auth/update-password")).toBe("/auth/update-password");
    expect(safeRedirect("/history?view=month")).toBe("/history?view=month");
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\n/evil.example", "", undefined])("rejects unsafe destination %s", (v) => expect(safeRedirect(v)).toBe("/"));
});
describe("password confirmation", () => {
  it("requires length and matching confirmation without trimming passwords", () => {
    expect(passwordProblem("short", "short")).not.toBeNull();
    expect(passwordProblem("long-password", "different")).not.toBeNull();
    expect(passwordProblem("long-password ", "long-password")).not.toBeNull();
    expect(passwordProblem("long-password", "long-password")).toBeNull();
  });
});
