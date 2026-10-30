import { nextAvailableLoad, previousAvailableLoad } from "./loads";
import { dominantLoad, effectiveLoad, sameLoad, workingSets } from "./sets";
import { attachmentRelation, compatibleHistory, historyForSide, historyTogether, sessionMode, sideLabel } from "./sides";
import type { AttachmentRef, ExerciseConfig, ExercisePerformance, LoggedSet, Prescription, Side, WeightUnit } from "./types";
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
  | "hold_shortened" //   planned sets omitted for time or equipment
  | "hold_incomplete" //  fewer sets than planned (fatigue, other or no reason)
  | "hold_below" //       last session below recent performance
  | "consider_reduce" //  repeatedly below the rep range
  | "add_reps_or_load" // bodyweight movement at top of range
  | "skill" //            technical work — no load progression
  | "sides_baseline" //   first session recording sides separately
  | "hold_sides"; //      one side is ready for more load, the other isn't

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
  /** When sides are recorded separately: each side's own recommendation. Prefill uses these. */
  sides?: Record<Side, Recommendation>;
}

interface Options {
  /** Require RIR ≥ 1 on all sets (when recorded) before a load increase. Default true. */
  conservative?: boolean;
}

function loadOf(sets: LoggedSet[], ex: ExerciseConfig): number | null {
  return dominantLoad(sets, ex);
}

function setsAt(sets: LoggedSet[], ex: ExerciseConfig, load: number): LoggedSet[] {
  return workingSets(sets, ex).filter((s) => sameLoad(effectiveLoad(s, ex), load));
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

const SHORTFALL_NOTE: Record<NonNullable<ExercisePerformance["shortfallReason"]> | "none", string> = {
  time: "The workout ended early (out of time). Omitted sets are not counted as failed.",
  equipment: "Equipment was unavailable. Omitted sets are not counted as failed.",
  fatigue: "You recorded that you couldn't finish the remaining sets.",
  other: "You recorded another reason for the omitted sets. No change in performance is inferred.",
  none: "No reason was recorded for the omitted sets. No change in performance is inferred.",
};

export function recommend(
  ex: ExerciseConfig,
  prescription: Prescription,
  history: ExercisePerformance[], // newest first, completed sessions only
  opts: Options = {},
): Recommendation {
  const conservative = opts.conservative ?? true;
  const { repMin, repMax, sets: required } = prescription;
  const sessions = history.filter((h) => workingSets(h.sets, ex).length > 0);
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

  // Fewer sets than planned last time → keep the load. Omitted sets are not failed sets: the completed
  // ones are real data, but too few to justify an increase, and they say nothing about a decline.
  const completedCount = workingSets(last.sets, ex).length;
  const lastRequired = last.prescription?.sets ?? required;
  if (completedCount < Math.min(required, lastRequired)) {
    const reason = last.shortfallReason ?? null;
    const external = reason === "time" || reason === "equipment";
    return {
      action: external ? "hold_shortened" : "hold_incomplete",
      targetLoadKg: displayLoad,
      targetReps: lastReps.length ? lastReps : null,
      reasons: [
        `Last session logged ${completedCount} of ${lastRequired} working sets.`,
        SHORTFALL_NOTE[reason ?? "none"],
        "Keep this load and resume the planned sets; there isn't enough evidence to increase it.",
      ],
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

// ---------- logging context: sides and attachment ----------

export interface LoggingContext {
  /** Sides are recorded separately in the workout being planned. */
  sides: boolean;
  attachment?: AttachmentRef | null;
}

// Most conservative first: when the two sides disagree, the combined advice follows the earlier one.
const CAUTION: RecommendationAction[] = [
  "hold_shortened", "hold_incomplete", "hold_below", "consider_reduce", "hold_effort", "hold_confirm",
  "hold_sides", "hold_build_reps", "first_time", "sides_baseline", "add_reps_or_load", "skill", "increase_load",
];

const sameTarget = (a: number | null, b: number | null) => (a == null || b == null ? a === b : sameLoad(a, b));

/** A side that met the criteria for more load, held at its current load because the other side didn't. */
function holdAtCurrent(rec: Recommendation, sideHistory: ExercisePerformance[], ex: ExerciseConfig, prescription: Prescription): Recommendation {
  const last = sideHistory.find((h) => workingSets(h.sets, ex).length > 0);
  const load = last ? loadOf(last.sets, ex) : null;
  return {
    ...rec,
    action: "hold_sides",
    targetLoadKg: load == null ? rec.targetLoadKg : toDisplayLoad(load, ex),
    targetReps: Array(prescription.sets).fill(prescription.repMax),
    reasons: [...rec.reasons.slice(0, 1), "The other side isn't ready yet. Keep this load until both sides are."],
  };
}

function combineSides(
  left: Recommendation, right: Recommendation,
  hist: Record<Side, ExercisePerformance[]>, ex: ExerciseConfig, prescription: Prescription,
): Recommendation {
  const evidence = left.evidenceSessionId ?? right.evidenceSessionId;
  const both = (action: RecommendationAction, l: Recommendation, r: Recommendation, reasons: string[]): Recommendation => ({
    action, targetLoadKg: sameTarget(l.targetLoadKg, r.targetLoadKg) ? l.targetLoadKg : null, targetReps: null,
    reasons, evidenceSessionId: evidence, sides: { left: l, right: r },
  });
  const sideReasons = (l: Recommendation, r: Recommendation) =>
    l.reasons.join(" ") === r.reasons.join(" ") ? [`Both sides: ${l.reasons[0]}`, ...l.reasons.slice(1)]
      : [`${sideLabel.left}: ${l.reasons[0]}`, `${sideLabel.right}: ${r.reasons[0]}`];

  if (left.action === "increase_load" && right.action === "increase_load" && sameTarget(left.targetLoadKg, right.targetLoadKg)) {
    return both("increase_load", left, right, [...sideReasons(left, right), "Both sides met the criteria for this load independently."]);
  }
  if (left.action === "increase_load" || right.action === "increase_load") {
    const l = left.action === "increase_load" ? holdAtCurrent(left, hist.left, ex, prescription) : left;
    const r = right.action === "increase_load" ? holdAtCurrent(right, hist.right, ex, prescription) : right;
    const ready = left.action === "increase_load" ? (right.action === "increase_load" ? null : "left") : "right";
    // A side short of its planned sets keeps the shortened-workout verdict for the pair.
    const other = ready === "left" ? right.action : ready === "right" ? left.action : "hold_sides";
    const action = CAUTION.find((a) => a === other || a === "hold_sides")!;
    return both(action, l, r, [
      ready ? `${sideLabel[ready as Side]} met the criteria for more load; ${sideLabel[ready === "left" ? "right" : "left"].toLowerCase()} didn't yet.`
        : "Both sides met the criteria, but for different loads.",
      ...sideReasons(l, r).slice(ready ? 1 : 0),
      "A shared load increase needs evidence from both sides. Keep the current load on each side.",
    ]);
  }
  const action = CAUTION.find((a) => a === left.action || a === right.action) ?? left.action;
  return both(action, left, right, sideReasons(left, right));
}

/**
 * The recommendation for an exercise in a given logging context. Only history recorded the same way
 * (sides vs. together) and with a compatible attachment is evidence. With sides recorded separately,
 * each side is judged on its own history.
 */
export function recommendFor(
  ex: ExerciseConfig, prescription: Prescription, history: ExercisePerformance[], ctx: LoggingContext, opts: Options = {},
): Recommendation {
  const compatible = compatibleHistory(history, ctx.attachment);
  const excluded = history.filter((h) => !compatible.includes(h)).map((h) => attachmentRelation(h.attachment, ctx.attachment));
  const setupNote = excluded.length === 0 ? null
    : excluded.every((r) => r === "unknown")
      ? ctx.attachment?.state
        ? "Sessions where no attachment was recorded aren't used as evidence for this setup."
        : "Sessions with a recorded attachment aren't used as evidence while today's attachment isn't recorded."
      : excluded.every((r) => r === "different")
        ? "Sessions with a different attachment aren't used as evidence."
        : "Sessions with a different or unrecorded attachment aren't used as evidence.";
  const withNote = (r: Recommendation): Recommendation => (setupNote ? { ...r, reasons: [...r.reasons, setupNote] } : r);

  if (!ctx.sides) {
    const rec = recommend(ex, prescription, historyTogether(compatible), opts);
    if (rec.action === "first_time" && compatible.some((h) => sessionMode(h.sets) !== "together")) {
      return withNote({ ...rec, reasons: [...rec.reasons, "Earlier sessions recorded left and right separately; they aren't compared with sets logged together."] });
    }
    return withNote(rec);
  }

  const hist = { left: historyForSide(compatible, "left"), right: historyForSide(compatible, "right") };
  const [left, right] = (["left", "right"] as Side[]).map((side) => {
    const rec = recommend(ex, prescription, hist[side], opts);
    // Sides were recorded last time but this one has no completed set: that's omitted work, not a fresh start.
    const last = hist[side][0];
    if (rec.action !== "first_time" || !last || ex.progression === "skill") return rec;
    const reason = last.shortfallReason ?? null;
    return {
      action: reason === "time" || reason === "equipment" ? "hold_shortened" : "hold_incomplete",
      targetLoadKg: null,
      targetReps: null,
      reasons: [`No ${sideLabel[side].toLowerCase()} sets were completed last time.`, SHORTFALL_NOTE[reason ?? "none"]],
      evidenceSessionId: last.sessionId,
    } satisfies Recommendation;
  });
  if (left.action === "first_time" && right.action === "first_time" && ex.progression !== "skill") {
    const last = historyTogether(compatible).find((h) => workingSets(h.sets, ex).length > 0);
    const load = last ? loadOf(last.sets, ex) : null;
    if (last && load != null) {
      const start: Recommendation = {
        action: "sides_baseline",
        targetLoadKg: toDisplayLoad(load, ex),
        targetReps: null,
        reasons: [
          "First session recording left and right separately. Earlier sessions were logged with one value for both sides.",
          "Start each side at your last load. Each side is compared with itself from next time.",
        ],
        evidenceSessionId: last.sessionId,
      };
      return withNote({ ...start, sides: { left: start, right: start } });
    }
    return withNote({ ...left, sides: { left, right } });
  }
  return withNote(combineSides(left, right, hist, ex, prescription));
}

/** One-line headline for the active workout, e.g. "Keep 60 kg. Aim for 10 / 10 / 9." */
export function headline(rec: Recommendation, ex: ExerciseConfig, unit: WeightUnit): string {
  if (rec.sides) return sidesHeadline(rec, ex, unit);
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
    case "hold_shortened":
      return `Workout ended early. Keep ${loadLabel(w!)} and resume planned sets.`;
    case "hold_incomplete":
      return `Fewer sets than planned last time. Keep ${loadLabel(w!)} and resume planned sets.`;
    case "hold_below":
      return `Last session was below your normal performance. Maintain ${loadLabel(w!)}.`;
    case "consider_reduce":
      return `Reps below range twice. Consider ${loadLabel(w!)}.`;
    case "add_reps_or_load":
      return "Top of range reached. Add reps or a small load.";
    case "sides_baseline":
      return w ? `First time logging sides separately. Start each side at ${loadLabel(w)}.` : "First time logging sides separately.";
    case "hold_sides":
      return w ? `Keep ${loadLabel(w)}.` : "Keep the current load on each side.";
  }
}

function sidesHeadline(rec: Recommendation, ex: ExerciseConfig, unit: WeightUnit): string {
  const { left, right } = rec.sides!;
  const fmt = (v: number) => {
    const s = formatWeight(v, unit);
    return ex.loadType === "assisted" ? `${s} assistance` : ex.loadType === "weighted_bodyweight" || ex.loadType === "bodyweight" ? `+${s}` : s;
  };
  const loads = left.targetLoadKg != null && right.targetLoadKg != null
    ? sameLoad(left.targetLoadKg, right.targetLoadKg) ? `${fmt(left.targetLoadKg)} each side` : `L ${fmt(left.targetLoadKg)} · R ${fmt(right.targetLoadKg)}`
    : null;
  const reps = (r: Recommendation) => r.targetReps?.join(" / ");
  const aim = left.targetReps && right.targetReps
    ? reps(left) === reps(right) ? ` Aim for ${reps(left)}.` : ` Aim L ${reps(left)} · R ${reps(right)}.`
    : "";
  switch (rec.action) {
    case "first_time":
      return "First time — find a working weight for each side with ~2 reps in reserve.";
    case "skill":
      return "Skill work — prioritise quality, speed and height.";
    case "sides_baseline":
      return loads ? `First time logging sides separately. Start at ${loads}.` : "First time logging sides separately.";
    case "increase_load":
      return `Both sides achieved all target reps. Consider ${loads ?? "the next load"} today.`;
    case "hold_sides":
      return `Keep ${loads ?? "each side's load"}. Add load when both sides are ready.`;
    case "hold_shortened":
    case "hold_incomplete":
      return `Not every side completed its planned sets last time. Keep ${loads ?? "each side's load"} and resume them.`;
    case "add_reps_or_load":
      return "Top of range reached on both sides. Add reps or a small load.";
    default:
      return loads ? `Keep ${loads}.${aim}` : `Keep each side's load.${aim}`;
  }
}
