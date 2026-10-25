import { nextAvailableLoad, previousAvailableLoad } from "./loads";
import { dominantLoad, effectiveLoad, sameLoad, workingSets } from "./sets";
import type { ExerciseConfig, ExercisePerformance, LoggedSet, Prescription, WeightUnit } from "./types";
import { formatWeight } from "./units";

/**
 * Transparent, rules-based progression. Every recommendation carries the evidence it used,
 * is conservative by default, and never prescribes a load change the user hasn't confirmed —
 * the UI only pre-fills suggested values that can be overridden.
 */

export type RecommendationAction =
  | "first_time" //       no history yet
  | "increase_load" //    criteria met for a load increase
  | "hold_build_reps" //  keep load, improve reps
  | "hold_confirm" //     top of range reached once; confirm before adding load
  | "hold_effort" //      top of range, but at failure — repeat first
  | "hold_incomplete" //  last session incomplete
  | "hold_below" //       last session below recent performance
  | "consider_reduce" //  repeatedly below the rep range
  | "add_reps_or_load" // bodyweight movement at top of range
  | "skill"; //           technical work — no load progression

export interface Recommendation {
  action: RecommendationAction;
  /** Suggested load in effective terms (kg; assisted = assistance kg, positive). null = no load suggestion. */
  targetLoadKg: number | null;
  /** Suggested reps per working set, if a concrete target applies. */
  targetReps: number[] | null;
  /** Human-readable reasons — the evidence behind the suggestion. */
  reasons: string[];
  /** Session the recommendation is derived from (used for dismissals). */
  evidenceSessionId: string | null;
}

interface Options {
  /** Require RIR ≥ 1 on all sets (when recorded) before a load increase. Default true. */
  conservative?: boolean;
}

function loadOf(sets: LoggedSet[], ex: ExerciseConfig): number | null {
  return dominantLoad(sets, ex);
}

function setsAt(sets: LoggedSet[], ex: ExerciseConfig, load: number): LoggedSet[] {
  return workingSets(sets).filter((s) => sameLoad(effectiveLoad(s, ex), load));
}

function totalReps(sets: LoggedSet[]): number {
  return sets.reduce((a, s) => a + (s.reps ?? 0), 0);
}

function allAtTop(sets: LoggedSet[], repMax: number, required: number): boolean {
  return sets.length >= required && sets.slice(0, required).every((s) => (s.reps ?? 0) >= repMax);
}

/** Convert an effective load back to what the user loads (assisted → assistance kg). */
function toDisplayLoad(effective: number, ex: ExerciseConfig): number {
  return ex.loadType === "assisted" ? -effective : effective;
}

export function recommend(
  ex: ExerciseConfig,
  prescription: Prescription,
  history: ExercisePerformance[], // newest first, completed sessions only
  opts: Options = {},
): Recommendation {
  const conservative = opts.conservative ?? true;
  const { repMin, repMax, sets: required } = prescription;
  const sessions = history.filter((h) => workingSets(h.sets).length > 0);
  const last = sessions[0];

  if (!last) {
    return {
      action: ex.progression === "skill" ? "skill" : "first_time",
      targetLoadKg: null,
      targetReps: null,
      reasons: [
        ex.progression === "skill"
          ? "No history yet. Focus on clean, fast reps; stop before quality drops."
          : `No history yet. Choose a load you can lift for about ${Math.max(repMin, repMax - 2)} reps with 2 reps in reserve.`,
      ],
      evidenceSessionId: null,
    };
  }

  const lastLoad = loadOf(last.sets, ex)!;
  const lastAtLoad = setsAt(last.sets, ex, lastLoad);
  const displayLoad = toDisplayLoad(lastLoad, ex);
  const lastReps = lastAtLoad.map((s) => s.reps ?? 0);
  const repsText = lastReps.join(" / ");
  const evidence = last.sessionId;

  // Skill work: never apply hypertrophy progression automatically.
  if (ex.progression === "skill") {
    const reasons = [`Last session: ${repsText} reps.`, "Progress through quality, speed and height — not load."];
    if (ex.loadType === "assisted" && allAtTop(lastAtLoad, repMax, required) && displayLoad > 0) {
      reasons.push("All sets reached the top of the range. If every rep was crisp, try slightly less assistance.");
    }
    return { action: "skill", targetLoadKg: displayLoad, targetReps: null, reasons, evidenceSessionId: evidence };
  }

  // Incomplete last session → repeat.
  const completedCount = workingSets(last.sets).length;
  const lastRequired = last.prescription?.sets ?? required;
  if (completedCount < Math.min(required, lastRequired)) {
    return {
      action: "hold_incomplete",
      targetLoadKg: displayLoad,
      targetReps: lastReps.length ? lastReps : null,
      reasons: [`Last session logged ${completedCount} of ${lastRequired} working sets. Repeat the load and complete all sets.`],
      evidenceSessionId: evidence,
    };
  }

  // Below recent performance at the same load → hold (requires a comparable prior session).
  const prior = sessions.slice(1).find((h) => {
    const l = loadOf(h.sets, ex);
    return l != null && sameLoad(l, lastLoad);
  });
  if (prior) {
    const priorReps = totalReps(setsAt(prior.sets, ex, lastLoad).slice(0, lastAtLoad.length));
    const nowReps = totalReps(lastAtLoad);
    if (priorReps - nowReps >= 2 && (priorReps - nowReps) / priorReps >= 0.08) {
      return {
        action: "hold_below",
        targetLoadKg: displayLoad,
        targetReps: setsAt(prior.sets, ex, lastLoad).slice(0, lastAtLoad.length).map((s) => s.reps ?? 0),
        reasons: [
          `Last session (${repsText}) was below your previous session at this load (${priorReps} vs ${nowReps} total reps).`,
          "One lower session isn't a trend. Keep the load and aim to match your previous reps.",
        ],
        evidenceSessionId: evidence,
      };
    }
  }

  // Repeatedly below the rep range at the same load → suggest (not apply) a reduction.
  const lastAvg = totalReps(lastAtLoad) / Math.max(1, lastAtLoad.length);
  if (prior && lastAvg < repMin) {
    const priorAt = setsAt(prior.sets, ex, lastLoad);
    const priorAvg = totalReps(priorAt) / Math.max(1, priorAt.length);
    if (priorAvg < repMin) {
      const lower =
        ex.loadType === "assisted"
          ? displayLoad + ex.incrementKg
          : previousAvailableLoad(lastLoad, ex);
      return {
        action: "consider_reduce",
        targetLoadKg: lower ?? displayLoad,
        targetReps: null,
        reasons: [
          `Average reps have been below ${repMin} for two sessions at this load.`,
          "Consider a slightly lighter load to train within your target range. Nothing changes unless you choose it.",
        ],
        evidenceSessionId: evidence,
      };
    }
  }

  const topNow = allAtTop(lastAtLoad, repMax, required);

  if (!topNow) {
    // Double progression: keep load, add a rep to each set that isn't at the top yet.
    const targets = lastAtLoad.slice(0, required).map((s) => Math.min(repMax, (s.reps ?? 0) + 1));
    while (targets.length < required) targets.push(targets[targets.length - 1] ?? repMin);
    return {
      action: "hold_build_reps",
      targetLoadKg: displayLoad,
      targetReps: targets,
      reasons: [`Last session: ${repsText}. Not every set reached ${repMax} yet — keep the load and build reps.`],
      evidenceSessionId: evidence,
    };
  }

  // At the top of the range.
  const rirs = lastAtLoad.map((s) => s.rir).filter((r): r is number => r != null);
  if (conservative && rirs.some((r) => r < 1)) {
    return {
      action: "hold_effort",
      targetLoadKg: displayLoad,
      targetReps: Array(required).fill(repMax),
      reasons: [
        `All sets reached ${repMax}, but at least one was taken to failure (RIR 0).`,
        "Repeat this load once with reps in reserve before increasing.",
      ],
      evidenceSessionId: evidence,
    };
  }

  if (ex.progression === "bodyweight_reps" || (ex.loadType === "bodyweight" && ex.progression !== "none")) {
    return {
      action: "add_reps_or_load",
      targetLoadKg: displayLoad,
      targetReps: null,
      reasons: [
        `All sets reached ${repMax} reps.`,
        `Keep adding reps, or add the smallest load / a harder variation to stay in the ${repMin}–${repMax} range.`,
      ],
      evidenceSessionId: evidence,
    };
  }

  if (ex.progression === "reps_first") {
    const prev = sessions[1];
    const prevLoad = prev ? loadOf(prev.sets, ex) : null;
    const confirmed =
      prev && prevLoad != null && sameLoad(prevLoad, lastLoad) && allAtTop(setsAt(prev.sets, ex, lastLoad), repMax, required);
    if (!confirmed) {
      return {
        action: "hold_confirm",
        targetLoadKg: displayLoad,
        targetReps: Array(required).fill(repMax),
        reasons: [
          `Top of the range reached once (${repsText}).`,
          "For this exercise, reps come first: confirm it next session before adding the smallest increment.",
        ],
        evidenceSessionId: evidence,
      };
    }
  }

  if (ex.progression === "none") {
    return {
      action: "hold_build_reps",
      targetLoadKg: displayLoad,
      targetReps: null,
      reasons: ["Automatic progression is off for this exercise."],
      evidenceSessionId: evidence,
    };
  }

  // Load increase (assisted: reduce assistance).
  let next: number | null;
  if (ex.loadType === "assisted") {
    next = Math.max(0, displayLoad - ex.incrementKg);
  } else {
    next = nextAvailableLoad(lastLoad, ex);
  }
  if (next == null) {
    return {
      action: "hold_build_reps",
      targetLoadKg: displayLoad,
      targetReps: null,
      reasons: ["All target reps achieved, but no heavier load is available. Add reps or slow the tempo."],
      evidenceSessionId: evidence,
    };
  }
  return {
    action: "increase_load",
    targetLoadKg: next,
    targetReps: Array(required).fill(repMin),
    reasons: [
      `All ${required} sets reached ${repMax} reps at this load (${repsText})${rirs.length ? " with reps in reserve" : ""}.`,
      `${ex.loadType === "assisted" ? "Reduce assistance by one step" : "Use the next available increment"} and start again at the bottom of the range.`,
    ],
    evidenceSessionId: evidence,
  };
}

/** One-line headline for the active workout, e.g. "Keep 60 kg. Aim for 10 / 10 / 9." */
export function headline(rec: Recommendation, ex: ExerciseConfig, unit: WeightUnit): string {
  const w = rec.targetLoadKg != null ? formatWeight(rec.targetLoadKg, unit) : null;
  const assisted = ex.loadType === "assisted";
  const loadLabel = (v: string) => (assisted ? `${v} assistance` : ex.loadType === "weighted_bodyweight" || ex.loadType === "bodyweight" ? `+${v}` : v);
  const reps = rec.targetReps ? rec.targetReps.join(" / ") : null;
  switch (rec.action) {
    case "first_time":
      return "First time — find a working weight with ~2 reps in reserve.";
    case "skill":
      return "Skill work — prioritise quality, speed and height.";
    case "increase_load":
      return assisted
        ? `All target reps achieved. Try ${loadLabel(w!)} next.`
        : `All target reps achieved. Consider ${loadLabel(w!)} today.`;
    case "hold_build_reps":
      return reps ? `Keep ${loadLabel(w!)}. Aim for ${reps}.` : `Keep ${loadLabel(w!)}.`;
    case "hold_confirm":
      return `Keep ${loadLabel(w!)}. Confirm ${reps} before adding load.`;
    case "hold_effort":
      return `Keep ${loadLabel(w!)}. Repeat ${reps} with a rep in reserve.`;
    case "hold_incomplete":
      return `Last session was incomplete. Repeat ${loadLabel(w!)}.`;
    case "hold_below":
      return `Last session was below your normal performance. Maintain ${loadLabel(w!)}.`;
    case "consider_reduce":
      return `Reps below range twice. Consider ${loadLabel(w!)}.`;
    case "add_reps_or_load":
      return "Top of range reached. Add reps or a small load.";
  }
}
