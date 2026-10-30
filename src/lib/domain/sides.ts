import { effectiveLoad, isValidWorkingSet } from "./sets";
import type { AttachmentRef, ExerciseConfig, ExercisePerformance, LoggedSet, Side, SideLog } from "./types";

/**
 * Left/right tracking rules. Three kinds of history stay distinguishable and are never merged:
 *
 * - together, bilateral:       one value for the whole set (barbell, machine, …)
 * - together, shared-value:    one value that applies to each side ("per dumbbell", "per side")
 * - sides recorded separately: each side has its own load, reps, RIR and completion
 *
 * Counting
 * - A left/right pair is ONE planned set. It is done when both sides are done; with one side done it
 *   is partial, so the exercise is short of plan (shortened-workout rules apply to the other side).
 * - A side that wasn't performed is unknown, never zero, and is never copied from the other side.
 * - Muscle-group set counts credit a pair as 1 set, a half-done pair as ½.
 *
 * Volume (load × reps)
 * - Sides recorded separately: left work + right work, each side's own load × own reps. Unequal sides
 *   are never averaged into a set that wasn't performed.
 * - Shared-value history keeps the value as it was logged (load × reps once). It is not doubled or
 *   reinterpreted, so volume isn't comparable across a change of mode; charts mark the mode.
 *
 * Comparison and progression
 * - A side is compared only with the same side in an earlier session that also recorded sides
 *   separately (set N with set N). Sets logged together are compared only with sets logged together.
 * - Each side gets its own recommendation from its own history. A load increase is suggested only
 *   when BOTH sides independently meet the criteria for the same load; otherwise both sides hold.
 * - Sessions with a different known attachment are not evidence for automatic progression.
 */

export const SIDES: Side[] = ["left", "right"];
export const sideLabel: Record<Side, string> = { left: "Left", right: "Right" };
export const sideShort: Record<Side, string> = { left: "L", right: "R" };

export const emptySide = (): SideLog => ({ weightKg: null, assistanceKg: null, reps: null, rir: null, completed: false });

export const isSided = (s: LoggedSet): s is LoggedSet & { sides: Record<Side, SideLog> } => !!s.sides;

/** The planned set is fully performed: both sides, when they are recorded separately. */
export function setDone(s: LoggedSet): boolean {
  return isSided(s) ? s.sides.left.completed && s.sides.right.completed : s.completed;
}

/** Some work was recorded for the set (one side is enough). */
export function setPerformed(s: LoggedSet): boolean {
  return isSided(s) ? s.sides.left.completed || s.sides.right.completed : s.completed;
}

/** One side as a stand-alone set, for comparisons and records within that side. */
export function sideAsSet(s: LoggedSet, side: Side): LoggedSet {
  const v = s.sides?.[side] ?? emptySide();
  return { kind: s.kind, weightKg: v.weightKg, assistanceKg: v.assistanceKg, reps: v.reps, rir: v.rir, completed: v.completed };
}

/** The sets of one side, in order. Sets logged together are not part of any side. */
export function sideStream(sets: LoggedSet[], side: Side): LoggedSet[] {
  return sets.filter(isSided).map((s) => sideAsSet(s, side));
}

/** Sets logged together (bilateral or one shared value). */
export function togetherSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter((s) => !isSided(s));
}

export type LoggingMode = "together" | "sides" | "mixed";

/** How a session's working sets were logged. */
export function sessionMode(sets: LoggedSet[]): LoggingMode {
  const ws = sets.filter((s) => s.kind === "working" && setPerformed(s));
  const sided = ws.filter(isSided).length;
  return sided === 0 ? "together" : sided === ws.length ? "sides" : "mixed";
}

/** History of one side: earlier sessions that recorded sides separately, reduced to that side. */
export function historyForSide(history: ExercisePerformance[], side: Side): ExercisePerformance[] {
  return history
    .filter((h) => sessionMode(h.sets) !== "together")
    .map((h) => ({ ...h, sets: sideStream(h.sets, side) }));
}

/** History of sets logged together, without any side data. */
export function historyTogether(history: ExercisePerformance[]): ExercisePerformance[] {
  return history
    .filter((h) => sessionMode(h.sets) !== "sides")
    .map((h) => ({ ...h, sets: togetherSets(h.sets) }));
}

/**
 * Every real, valid working set: sets logged together as they are, and each performed side as its
 * own set. Used for bests and charts, which look at actual sets and never at a merged pair.
 */
export function performedSets(sets: LoggedSet[], ex: Pick<ExerciseConfig, "loadType">): LoggedSet[] {
  return sets.flatMap((s) => (isSided(s) ? SIDES.map((side) => sideAsSet(s, side)) : [s])).filter((s) => isValidWorkingSet(s, ex));
}

/** Load × reps of a working set (external load only). Sides recorded separately add up: left + right. */
export function setVolumeKg(s: LoggedSet, ex: Pick<ExerciseConfig, "loadType">): number {
  const parts = isSided(s) ? SIDES.map((side) => sideAsSet(s, side)) : [s];
  return parts.filter((p) => isValidWorkingSet(p, ex)).reduce((a, p) => a + Math.max(0, p.weightKg ?? 0) * p.reps!, 0);
}

/** Working sets credited to muscle-group counts: a pair counts once, a half-done pair counts ½. */
export function setCredit(s: LoggedSet): number {
  if (s.kind !== "working") return 0;
  if (!isSided(s)) return s.completed ? 1 : 0;
  return (Number(s.sides.left.completed) + Number(s.sides.right.completed)) / 2;
}

/** Planned working sets that count as done (both sides when tracked separately). */
export function doneWorkingSets(sets: LoggedSet[]): number {
  return sets.filter((s) => s.kind === "working" && setDone(s)).length;
}

/** Whether a set holds anything typed or performed, so switching its mode would lose data. */
export function setHasData(s: LoggedSet): boolean {
  if (isSided(s)) return SIDES.some((side) => sideHasData(s.sides[side]));
  return s.completed || s.weightKg != null || s.assistanceKg != null || s.reps != null || s.rir != null;
}

export function sideHasData(v: SideLog): boolean {
  return v.completed || v.weightKg != null || v.assistanceKg != null || v.reps != null || v.rir != null;
}

/** Unequal sides of a performed pair, for display ("L 25 × 10 · R 22.5 × 8"). Never averaged. */
export function sidesDiffer(s: LoggedSet, ex: Pick<ExerciseConfig, "loadType">): boolean {
  if (!isSided(s)) return false;
  const [l, r] = SIDES.map((side) => sideAsSet(s, side));
  return effectiveLoad(l, ex) !== effectiveLoad(r, ex) || l.reps !== r.reps;
}

// ---------- attachments ----------

/**
 * How two sessions' attachments relate:
 * - "same":       the same recorded attachment (same id, renames included), or both "No attachment"
 * - "different":  two different recorded attachments, or an attachment vs. "No attachment"
 * - "unknown":    one side recorded, the other "Not recorded". Unknown is not a wildcard: it may or
 *                 may not have been the same setup, so it is never treated as matching.
 * - "unrecorded": neither recorded (e.g. history from before attachments existed, logged the same way)
 */
export type AttachmentRelation = "same" | "different" | "unknown" | "unrecorded";

export function attachmentRelation(prev: AttachmentRef | null | undefined, cur: AttachmentRef | null | undefined): AttachmentRelation {
  if (!prev?.state && !cur?.state) return "unrecorded";
  if (!prev?.state || !cur?.state) return "unknown";
  if (prev.state !== cur.state) return "different";
  return prev.state === "none" || prev.id === cur.id ? "same" : "different";
}

/**
 * Whether an earlier session is evidence for automatic progression and comparisons in the current
 * setup: only "same" and "unrecorded". A session whose attachment wasn't recorded is NOT evidence once
 * the current workout records one (and vice versa); it is still shown in history, labelled.
 */
export function attachmentsCompatible(a: AttachmentRef | null | undefined, b: AttachmentRef | null | undefined): boolean {
  const r = attachmentRelation(a, b);
  return r === "same" || r === "unrecorded";
}

export function attachmentLabel(a: AttachmentRef | null | undefined): string {
  if (!a?.state) return "Not recorded";
  return a.state === "none" ? "No attachment" : a.name ?? "Attachment";
}

/** History that may be used as evidence for the current setup. */
export function compatibleHistory(history: ExercisePerformance[], current: AttachmentRef | null | undefined): ExercisePerformance[] {
  return history.filter((h) => attachmentsCompatible(h.attachment, current));
}

// ---------- suitability ----------

const UNILATERAL_NAME = /single[- ]?(arm|leg)|one[- ]?(arm|leg)|unilateral|split squat|bulgarian|lunge|step[- ]?up|pistol|concentration|kickback/i;

/**
 * Exercises for which "Track sides separately" is offered: unilateral or easily done one side at a
 * time. Skill work never is. Mirrors nothing in the database; it only decides whether the option shows.
 */
export function sideTrackingSuitable(e: { name: string; equipment: string; category: string; weight_convention?: string }): boolean {
  if (e.category === "skill") return false;
  if (e.weight_convention === "per_dumbbell" || e.weight_convention === "per_side") return true;
  if (e.equipment === "dumbbell" || e.equipment === "cable") return true;
  return UNILATERAL_NAME.test(e.name);
}
