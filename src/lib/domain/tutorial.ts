import type { ProfileRow } from "@/lib/data/types";

export type TutorialOutcome = "completed" | "skipped";

/**
 * Whether the first-use tutorial opens by itself. Only for an account that finished setup and has never
 * finished or skipped it (migration 017 stores that per account, so other devices and sign-ins agree).
 * Accounts that predate onboarding ('legacy') are existing users: they can open it from Settings.
 */
export function shouldShowTutorial(p: Pick<ProfileRow, "onboarded_at" | "setup_choice" | "tutorial_done_at">): boolean {
  return p.onboarded_at != null && p.tutorial_done_at == null && p.setup_choice !== "legacy";
}
