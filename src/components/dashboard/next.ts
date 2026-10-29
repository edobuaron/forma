import type { StartTemplate } from "@/lib/data/queries";

/** The workout you've gone longest without (never-done first, then program order). A suggestion, not a schedule. */
export function pickNext(templates: StartTemplate[]): StartTemplate | null {
  if (!templates.length) return null;
  return [...templates].sort((a, b) => (a.lastDone ?? "").localeCompare(b.lastDone ?? ""))[0];
}
