import { describe, expect, it } from "vitest";
import { shouldShowTutorial } from "../tutorial";

const fresh = { onboarded_at: "2026-10-31T10:00:00Z", setup_choice: null, tutorial_done_at: null } as const;

describe("first-use tutorial", () => {
  it("opens for a new account once setup is done", () => {
    expect(shouldShowTutorial(fresh)).toBe(true);
    expect(shouldShowTutorial({ ...fresh, setup_choice: "starter" })).toBe(true);
  });
  it("waits until setup is done", () => {
    expect(shouldShowTutorial({ ...fresh, onboarded_at: null })).toBe(false);
  });
  it("never opens again once finished or skipped, whatever the device", () => {
    expect(shouldShowTutorial({ ...fresh, tutorial_done_at: "2026-10-31T10:05:00Z" })).toBe(false);
  });
  it("leaves accounts that predate onboarding alone", () => {
    expect(shouldShowTutorial({ ...fresh, setup_choice: "legacy" })).toBe(false);
  });
});
