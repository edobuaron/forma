import { epley } from "./e1rm";
import { completedWorkingSets, effectiveLoad, hasLoggedLoad, isValidWorkingSet, sameLoad, workingSets } from "./sets";
import { historyForSide, historyTogether, setVolumeKg, sideStream, togetherSets } from "./sides";
import type { ExerciseConfig, ExercisePerformance, LoggedSet, Side } from "./types";

export type ComparisonStatus =
  | "improved" //  better by an unambiguous measure
  | "matched" //   same load, same reps
  | "below" //     worse by an unambiguous measure
  | "not_comparable" // load and reps moved in opposite directions and no valid estimate exists
  | "extra" //       the previous comparable session had no set at this position: additional work, not a verdict
  | "no_previous"; // nothing valid to compare with

export interface SetComparison {
  status: ComparisonStatus;
  loadDeltaKg: number; // in effective-load terms (assistance: positive = less assistance)
  repDelta: number;
  /** Only set when the verdict relied on an estimated 1RM. */
  e1rmDeltaKg?: number;
  basis: "same_load" | "same_reps" | "both_better" | "both_worse" | "e1rm" | "none";
}

const NONE: SetComparison = { status: "no_previous", loadDeltaKg: 0, repDelta: 0, basis: "none" };

/**
 * Compare a completed set with the corresponding previous set.
 * Conservative: when load and reps move in opposite directions we only give a verdict
 * if an estimated 1RM is appropriate for this exercise and both sets are within 1–12 reps;
 * otherwise we say the sets aren't directly comparable rather than guess.
 */
export function compareSet(
  current: LoggedSet,
  previous: LoggedSet | null | undefined,
  ex: Pick<ExerciseConfig, "loadType" | "e1rmEligible">,
): SetComparison {
  if (!previous || !isValidWorkingSet(previous, ex) || !isValidWorkingSet(current, ex)) return NONE;
  const cl = effectiveLoad(current, ex);
  const pl = effectiveLoad(previous, ex);
  const cr = current.reps!;
  const pr = previous.reps!;
  const loadDeltaKg = Math.round((cl - pl) * 100) / 100;
  const repDelta = cr - pr;

  if (sameLoad(cl, pl)) {
    return {
      status: repDelta > 0 ? "improved" : repDelta < 0 ? "below" : "matched",
      loadDeltaKg: 0,
      repDelta,
      basis: "same_load",
    };
  }
  if (repDelta === 0) {
    return { status: loadDeltaKg > 0 ? "improved" : "below", loadDeltaKg, repDelta, basis: "same_reps" };
  }
  if (loadDeltaKg > 0 && repDelta > 0) return { status: "improved", loadDeltaKg, repDelta, basis: "both_better" };
  if (loadDeltaKg < 0 && repDelta < 0) return { status: "below", loadDeltaKg, repDelta, basis: "both_worse" };

  // Opposite directions (e.g. heavier load, fewer reps — the normal result of a planned load increase).
  // Never call this "below": an estimated 1RM may only confirm an improvement or similar strength,
  // and only for lifts where the estimate is appropriate. Otherwise it's a new, not directly comparable baseline.
  if (ex.e1rmEligible && ex.loadType === "external") {
    const c = epley(cl, cr);
    const p = epley(pl, pr);
    if (c != null && p != null) {
      const d = c - p;
      const rel = d / p;
      if (rel > 0.02) return { status: "improved", loadDeltaKg, repDelta, e1rmDeltaKg: Math.round(d * 10) / 10, basis: "e1rm" };
      if (rel >= -0.02) return { status: "matched", loadDeltaKg, repDelta, e1rmDeltaKg: Math.round(d * 10) / 10, basis: "e1rm" };
    }
  }
  return { status: "not_comparable", loadDeltaKg, repDelta, basis: "none" };
}

// ---------- pairing by working-set position ----------

export interface PositionedSet {
  /** 0-based working-set position within its stream. */
  pos: number;
  set: LoggedSet;
}

/**
 * Working sets of one stream with their working-set position. Warm-ups and drop segments are not
 * working sets, so they never move a position. A stored workingNo (kept at finish, so a skipped set
 * leaves its number unused) wins; otherwise the order gives the position. Positions only increase.
 * Completion is not filtered here: an undone or load-less set keeps its place instead of shifting
 * the sets after it.
 */
export function workingPositions(sets: LoggedSet[]): PositionedSet[] {
  const out: PositionedSet[] = [];
  let cursor = -1;
  for (const set of sets) {
    if (set.kind !== "working") continue;
    const stored = set.workingNo != null && set.workingNo > 0 ? set.workingNo - 1 : null;
    cursor = stored != null && stored > cursor ? stored : cursor + 1;
    out.push({ pos: cursor, set });
  }
  return out;
}

/** Completed working sets with reps: the sets a comparison is shown for. */
const performedWorking = (s: LoggedSet) => s.kind === "working" && s.completed && s.reps != null && s.reps > 0;

export interface Counterpart {
  /** The previous set at the same working-set position, when it is valid to compare with. */
  previous: LoggedSet | null;
  /** The previous session had no working set at or beyond this position: this set is additional work. */
  extra: boolean;
}

/**
 * The previous session's set at the same working-set position (first with first, second with second).
 * Never falls back to another position, such as the previous final set. A position beyond the
 * previous session's last working set is "extra"; a position the previous session skipped, or a set
 * without a logged load, has no counterpart.
 */
export function counterpart(previousSets: LoggedSet[], workingIndex: number, ex: Pick<ExerciseConfig, "loadType">): Counterpart {
  const done = workingPositions(previousSets).filter((p) => performedWorking(p.set));
  if (done.length === 0) return { previous: null, extra: false };
  const last = done[done.length - 1].pos;
  if (workingIndex > last) return { previous: null, extra: true };
  const s = done.find((p) => p.pos === workingIndex)?.set;
  return { previous: s && hasLoggedLoad(s, ex) ? s : null, extra: false };
}

/** The previous set at the same working-set position, or null. See counterpart(). */
export function previousCounterpart(previousSets: LoggedSet[], workingIndex: number, ex: Pick<ExerciseConfig, "loadType">): LoggedSet | null {
  return counterpart(previousSets, workingIndex, ex).previous;
}

const EXTRA: SetComparison = { status: "extra", loadDeltaKg: 0, repDelta: 0, basis: "none" };

/** Compare a set with its counterpart; an extra set gets no verdict. */
export function compareWithCounterpart(current: LoggedSet, c: Counterpart, ex: Pick<ExerciseConfig, "loadType" | "e1rmEligible">): SetComparison {
  if (c.extra) return performedWorking(current) ? EXTRA : NONE;
  return compareSet(current, c.previous, ex);
}

export interface PreviousSummary {
  completedWorkingSets: number;
  prescribedSets: number | null;
  incomplete: boolean;
}

export function summarisePrevious(previousSets: LoggedSet[], prescribedSets: number | null): PreviousSummary {
  const n = completedWorkingSets(previousSets).length;
  return {
    completedWorkingSets: n,
    prescribedSets,
    incomplete: prescribedSets != null && n < prescribedSets,
  };
}

// ---------- streams: sets logged together vs. each side ----------

export type Stream = "together" | Side;

/** The latest earlier session that recorded this stream (history newest first, attachment-compatible). */
export function previousFor(history: ExercisePerformance[], stream: Stream, ex: Pick<ExerciseConfig, "loadType">): ExercisePerformance | null {
  const h = stream === "together" ? historyTogether(history) : historyForSide(history, stream);
  return h.find((p) => workingSets(p.sets, ex).length > 0) ?? null;
}

export interface StreamComparison {
  stream: Stream;
  /** Working-set position within this stream (0-based). */
  index: number;
  set: LoggedSet;
  previous: LoggedSet | null;
  comparison: SetComparison;
}

const streamSets = (sets: LoggedSet[], stream: Stream) => (stream === "together" ? togetherSets(sets) : sideStream(sets, stream));
const STREAMS: Stream[] = ["together", "left", "right"];

/**
 * Compare a session's completed working sets with the previous session, stream by stream: sets logged
 * together with sets logged together, each side with the same side. Never across streams. Sets are
 * paired by working-set position; a set beyond the previous session's sets is "extra".
 */
export function compareStreams(current: LoggedSet[], history: ExercisePerformance[], ex: Pick<ExerciseConfig, "loadType" | "e1rmEligible">): StreamComparison[] {
  const out: StreamComparison[] = [];
  for (const stream of STREAMS) {
    const sets = workingPositions(streamSets(current, stream)).filter((p) => performedWorking(p.set));
    if (sets.length === 0) continue;
    const prev = previousFor(history, stream, ex);
    for (const { pos, set } of sets) {
      const c = prev ? counterpart(prev.sets, pos, ex) : { previous: null, extra: false };
      out.push({ stream, index: pos, set, previous: c.previous, comparison: compareWithCounterpart(set, c, ex) });
    }
  }
  return out;
}

// ---------- matched sets vs. additional work ----------

export interface SessionComparisonSummary {
  /** Sets paired with a set at the same position last time (whatever the verdict). */
  comparable: number;
  /** Sets beyond the previous comparable session's sets. */
  extra: number;
  /** Previous sets at positions with no completed set this time. */
  fewer: number;
  /** Actual work this session: completed working sets and load × reps (external load only). */
  current: { sets: number; volumeKg: number };
  /** The same for the previous comparable session(s), stream by stream. null = nothing earlier. */
  previous: { sets: number; volumeKg: number } | null;
}

/**
 * Separates performance on matched sets from additional work, and gives actual total volume with its
 * set counts so a change in the number of sets stays visible. Volume is reported, never judged.
 */
export function summariseComparison(items: StreamComparison[], current: LoggedSet[], history: ExercisePerformance[], ex: Pick<ExerciseConfig, "loadType">): SessionComparisonSummary {
  const comparable = items.filter((c) => c.previous != null).length;
  const extra = items.filter((c) => c.comparison.status === "extra").length;
  let fewer = 0;
  let prevSets = 0;
  let prevVolume = 0;
  let anyPrev = false;
  let curSets = 0;
  let curVolume = 0;
  for (const stream of STREAMS) {
    const cur = workingPositions(streamSets(current, stream)).filter((p) => performedWorking(p.set));
    curSets += cur.length;
    curVolume += cur.reduce((a, p) => a + setVolumeKg(p.set, ex), 0);
    if (cur.length === 0) continue;
    const prev = previousFor(history, stream, ex); // its sets are already this stream's
    if (!prev) continue;
    anyPrev = true;
    const done = workingPositions(prev.sets).filter((p) => performedWorking(p.set));
    prevSets += done.length;
    prevVolume += done.reduce((a, p) => a + setVolumeKg(p.set, ex), 0);
    const now = new Set(cur.map((p) => p.pos));
    fewer += done.filter((p) => !now.has(p.pos)).length;
  }
  return {
    comparable, extra, fewer,
    current: { sets: curSets, volumeKg: Math.round(curVolume * 100) / 100 },
    previous: anyPrev ? { sets: prevSets, volumeKg: Math.round(prevVolume * 100) / 100 } : null,
  };
}
