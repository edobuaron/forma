// When completing a set starts the rest timer. Pure; the timer itself is in src/lib/domain/rest.ts.
import { setDone } from "@/lib/domain/sides";
import type { Side } from "@/lib/domain/types";
import { dropSegmentsOf, type SetRow } from "./set-rows";
import { toLoggedSet } from "./types";

export type RestTrigger = "none" | "rest" | "between_sides";

/**
 * - Warm-ups never start the normal rest.
 * - A drop set rests once, after its last segment: never between the working set and its drops, or
 *   between drops.
 * - A left/right pair rests once both sides are done. Rest between the sides happens only when the
 *   user turned it on, and only for a set without drops (a drop sequence continues on that side).
 * There is only ever one timer: a new rest replaces the one running.
 */
export function restTrigger(sets: SetRow[], setId: string, opts: { betweenSides?: boolean; side?: Side } = {}): RestTrigger {
  const s = sets.find((x) => x.id === setId);
  if (!s || s.kind === "warmup") return "none";
  const parentId = s.kind === "drop" ? s.drop_parent_id : s.id;
  const parent = sets.find((x) => x.id === parentId);
  const drops = parent ? dropSegmentsOf(sets, parent.id) : [];
  const group = parent ? [parent, ...drops] : [s];
  if (s.sided && opts.side) {
    const sideDone = !!s[`${opts.side}_completed`];
    if (!sideDone) return "none";
    if (!setDone(toLoggedSet(s))) {
      return opts.betweenSides && s.kind === "working" && drops.length === 0 ? "between_sides" : "none";
    }
  } else if (!setDone(toLoggedSet(s))) return "none";
  if (!group.every((x) => setDone(toLoggedSet(x)))) return "none";
  if (s.kind === "working" && drops.length > 0) return "none"; // its drops follow right away
  return "rest";
}
