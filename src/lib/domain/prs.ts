import { setE1rm } from "./e1rm";
import { effectiveLoad, sameLoad, workingSets } from "./sets";
import { SIDES, sideStream, togetherSets } from "./sides";
import type { ExerciseConfig, LoggedSet, Side } from "./types";

export type PRType = "heaviest_load" | "reps_at_load" | "best_e1rm" | "most_reps" | "first_skill" | "least_assistance";

export interface PersonalRecord {
  type: PRType;
  /** Effective load of the record set (kg). */
  loadKg: number;
  reps: number;
  /** Previous best value for context (load for heaviest, reps for reps_at_load, e1RM kg …). */
  previous: number | null;
  value: number;
}

/**
 * Detect genuine personal records in `current` against all earlier sets for the same exercise.
 * Rules designed to avoid meaningless records:
 * - no records on the very first session (there is nothing to beat)
 * - load records only for loaded movements; not for skill work
 * - rep records only at a load that has been used before
 * - e1RM only for eligible lifts within 1–12 reps, and must beat the old best by > 0.5 %
 */
export function detectPRs(ex: ExerciseConfig, current: LoggedSet[], history: LoggedSet[]): PersonalRecord[] {
  const cur = workingSets(current, ex);
  const hist = workingSets(history, ex);
  const out: PersonalRecord[] = [];
  if (cur.length === 0) return out;

  if (ex.category === "skill") {
    const isMuscleUp = /muscle.?up/i.test(ex.name) && !/transition/i.test(ex.name);
    if (isMuscleUp && hist.length === 0) {
      out.push({ type: "first_skill", loadKg: 0, reps: cur[0].reps!, previous: null, value: cur[0].reps! });
    }
    if (ex.loadType === "assisted" && hist.length > 0) {
      const prevMin = Math.min(...hist.map((s) => s.assistanceKg ?? 0));
      const best = cur.reduce((a, s) => ((s.assistanceKg ?? 0) < (a.assistanceKg ?? 0) ? s : a));
      if ((best.assistanceKg ?? 0) < prevMin - 0.01) {
        out.push({ type: "least_assistance", loadKg: effectiveLoad(best, ex), reps: best.reps!, previous: prevMin, value: best.assistanceKg ?? 0 });
      }
    }
    return out;
  }
  if (hist.length === 0) return out;

  // Bodyweight with no added load: rep records only.
  const loaded = ex.loadType === "external" || ex.loadType === "weighted_bodyweight";
  if (!loaded || cur.every((s) => (s.weightKg ?? 0) === 0)) {
    if (ex.loadType === "bodyweight" || ex.loadType === "weighted_bodyweight") {
      const unloadedHist = hist.filter((s) => (s.weightKg ?? 0) === 0);
      const unloadedCur = cur.filter((s) => (s.weightKg ?? 0) === 0);
      if (unloadedHist.length && unloadedCur.length) {
        const prev = Math.max(...unloadedHist.map((s) => s.reps!));
        const best = Math.max(...unloadedCur.map((s) => s.reps!));
        if (best > prev) out.push({ type: "most_reps", loadKg: 0, reps: best, previous: prev, value: best });
      }
    }
    if (!loaded) return out;
  }

  // Heaviest load (with at least as many reps as 1).
  const prevMaxLoad = Math.max(...hist.map((s) => effectiveLoad(s, ex)));
  const heaviest = cur.reduce((a, s) => (effectiveLoad(s, ex) > effectiveLoad(a, ex) ? s : a));
  if (effectiveLoad(heaviest, ex) > prevMaxLoad + 0.01 && effectiveLoad(heaviest, ex) > 0) {
    out.push({ type: "heaviest_load", loadKg: effectiveLoad(heaviest, ex), reps: heaviest.reps!, previous: prevMaxLoad, value: effectiveLoad(heaviest, ex) });
  }

  // Most reps at a previously used load (report the best such improvement).
  let bestRep: PersonalRecord | null = null;
  for (const s of cur) {
    const l = effectiveLoad(s, ex);
    if (l <= 0 && ex.loadType !== "external") continue;
    const atLoad = hist.filter((h) => sameLoad(effectiveLoad(h, ex), l));
    if (atLoad.length === 0) continue;
    const prev = Math.max(...atLoad.map((h) => h.reps!));
    if (s.reps! > prev && (!bestRep || s.reps! - prev > bestRep.reps - (bestRep.previous ?? 0))) {
      bestRep = { type: "reps_at_load", loadKg: l, reps: s.reps!, previous: prev, value: s.reps! };
    }
  }
  if (bestRep) out.push(bestRep);

  // Estimated 1RM.
  if (ex.e1rmEligible && ex.loadType === "external") {
    const prevBest = Math.max(0, ...hist.map((s) => setE1rm(s, ex) ?? 0));
    let best: { s: LoggedSet; v: number } | null = null;
    for (const s of cur) {
      const v = setE1rm(s, ex);
      if (v != null && (!best || v > best.v)) best = { s, v };
    }
    if (best && prevBest > 0 && best.v > prevBest * 1.005) {
      out.push({ type: "best_e1rm", loadKg: best.s.weightKg!, reps: best.s.reps!, previous: Math.round(prevBest * 10) / 10, value: Math.round(best.v * 10) / 10 });
    }
  }
  return out;
}

export type SidedRecord = PersonalRecord & { side: Side | null };

/**
 * Records kept per stream: sets logged together are compared only with sets logged together, and
 * each side only with the same side. A left-arm record never beats a right-arm one, or vice versa.
 */
export function detectRecords(ex: ExerciseConfig, current: LoggedSet[], history: LoggedSet[]): SidedRecord[] {
  const together = detectPRs(ex, togetherSets(current), togetherSets(history)).map((r) => ({ ...r, side: null }));
  const sides = SIDES.flatMap((side) =>
    detectPRs(ex, sideStream(current, side), sideStream(history, side)).map((r) => ({ ...r, side })));
  return [...together, ...sides];
}

export function prLabel(type: PRType): string {
  return {
    heaviest_load: "Heaviest set",
    reps_at_load: "Most reps at this weight",
    best_e1rm: "Best estimated 1RM",
    most_reps: "Most reps",
    first_skill: "First successful rep",
    least_assistance: "Least assistance",
  }[type];
}

