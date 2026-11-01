// One-line description of a finished workout for lists: lifting counts and runs, each only when present.
import { runTotals, totalsText, type DistanceUnit } from "@/lib/domain/running";
import type { SessionListItem } from "@/lib/data/queries";

export function sessionLine(s: Pick<SessionListItem, "exercise_count" | "set_count" | "runs">, unit: DistanceUnit): string {
  const runs = s.runs ?? [];
  const lifting = s.exercise_count > 0 || runs.length === 0 ? `${s.exercise_count} exercises · ${s.set_count} sets` : null;
  const running = runs.length ? totalsText(runTotals(runs), unit) : null;
  return [lifting, running].filter(Boolean).join(" · ");
}
