import { dominantLoad, effectiveLoad, sameLoad, workingSets } from "./sets";
import { sessionMode, setPerformed } from "./sides";
import type { ExerciseConfig, ExercisePerformance } from "./types";
import { MUSCLE_LABELS } from "./analytics";

/**
 * Recovery-aware, evidence-informed observations. Deliberately conservative:
 * - minimum-data thresholds on every rule
 * - never diagnostic ("overtraining", "injury") language
 * - one bad session is never treated as a trend
 * - never changes training automatically
 */

export type InsightSeverity = "info" | "attention";

export interface Insight {
  key: string; // stable rule key for dismissals, e.g. "decline:<exerciseId>"
  severity: InsightSeverity;
  title: string;
  detail: string; // why it appeared
  exerciseId?: string;
  evidenceSessionId?: string;
}

const MIN_SESSIONS_TREND = 3;
const MIN_SESSIONS_PLATEAU = 4;

function repsAtLoad(h: ExercisePerformance, ex: ExerciseConfig, load: number) {
  return workingSets(h.sets, ex)
    .filter((s) => sameLoad(effectiveLoad(s, ex), load))
    .reduce((a, s) => a + (s.reps ?? 0), 0);
}

/** Exercise-level insights from that exercise's completed history (newest first). */
export function exerciseInsights(ex: ExerciseConfig, history: ExercisePerformance[]): Insight[] {
  if (ex.category === "skill") return [];
  const sessions = history.filter((h) => workingSets(h.sets, ex).length > 0);
  const out: Insight[] = [];
  if (sessions.length < MIN_SESSIONS_TREND) return out;

  // Decline across the last three comparable sessions (same dominant load, same set count).
  const recent = sessions.slice(0, MIN_SESSIONS_TREND);
  const load = dominantLoad(recent[0].sets, ex);
  if (load != null) {
    // A session with planned sets omitted is not comparable: fewer reps there is missing work, not decline.
    const comparable = recent.every((h) => {
      const l = dominantLoad(h.sets, ex);
      const n = workingSets(h.sets, ex).length;
      return l != null && sameLoad(l, load) && n === workingSets(recent[0].sets, ex).length
        && (h.prescription == null || n >= h.prescription.sets);
    });
    if (comparable) {
      const reps = recent.map((h) => repsAtLoad(h, ex, load)); // newest first
      const declining = reps[0] < reps[1] && reps[1] < reps[2] && reps[2] - reps[0] >= 2;
      const rirs = recent.flatMap((h) => workingSets(h.sets, ex).map((s) => s.rir)).filter((r): r is number => r != null);
      const bwChange = bodyweightChange(recent);
      if (declining) {
        out.push({
          key: `decline:${ex.id}`,
          severity: "attention",
          title: `${ex.name}: performance declined across the last three comparable sessions`,
          detail:
            `Total reps at the same load went ${[...reps].reverse().join(" → ")}. ` +
            (bwChange != null && Math.abs(bwChange) >= 1.5 && ex.loadType !== "external"
              ? `Recorded bodyweight changed by ${bwChange > 0 ? "+" : ""}${bwChange.toFixed(1)} kg over this period, which affects bodyweight movements. `
              : "") +
            "Consider maintaining the load and reviewing sleep, nutrition and recovery between sessions. This is a pattern in your logs, not a diagnosis.",
          exerciseId: ex.id,
          evidenceSessionId: recent[0].sessionId,
        });
      }
      if (!declining && rirs.length >= 6 && rirs.filter((r) => r === 0).length / rirs.length >= 0.75) {
        out.push({
          key: `effort:${ex.id}`,
          severity: "info",
          title: `${ex.name}: most recent sets were taken to failure`,
          detail: "Over the last three sessions, at least 75% of logged sets were recorded at RIR 0. Leaving a rep in reserve on some sets can make progress more sustainable.",
          exerciseId: ex.id,
          evidenceSessionId: recent[0].sessionId,
        });
      }
    }
  }

  // Plateau: same load and essentially the same reps for 4+ sessions.
  if (sessions.length >= MIN_SESSIONS_PLATEAU && load != null) {
    const window = sessions.slice(0, MIN_SESSIONS_PLATEAU);
    const sameLoadAll = window.every((h) => {
      const l = dominantLoad(h.sets, ex);
      return l != null && sameLoad(l, load);
    });
    if (sameLoadAll) {
      const reps = window.map((h) => repsAtLoad(h, ex, load));
      if (Math.max(...reps) - Math.min(...reps) <= 1 && !out.some((i) => i.key.startsWith("decline"))) {
        out.push({
          key: `plateau:${ex.id}`,
          severity: "info",
          title:
            ex.progression === "reps_first"
              ? `${ex.name} has remained stable for ${window.length} sessions`
              : `${ex.name} hasn't progressed in ${window.length} sessions`,
          detail:
            ex.progression === "reps_first"
              ? "Try adding a single rep to one set before adding weight."
              : "Same load and reps for several sessions. Small changes — one extra rep on the last set, slower eccentrics, or a longer rest — often restart progress.",
          exerciseId: ex.id,
          evidenceSessionId: window[0].sessionId,
        });
      }
    }
  }
  return out;
}

function bodyweightChange(newestFirst: ExercisePerformance[]): number | null {
  const bws = newestFirst.map((h) => h.bodyweightKg).filter((b): b is number => b != null);
  if (bws.length < 2) return null;
  return bws[0] - bws[bws.length - 1];
}

export interface WeeklyMuscleSets {
  week: string; // Monday yyyy-mm-dd
  sets: Record<string, number>;
}

/**
 * Flags a substantial jump in weekly sets for a muscle group vs. the prior 3-week average.
 * Muscles the user keeps at maintenance (profiles.maintenance_muscles) get the same check, worded
 * against that choice. Neither version ever suggests adding sets.
 */
export function volumeInsights(weeks: WeeklyMuscleSets[], currentWeek: string, maintenance: readonly string[] = []): Insight[] {
  const sorted = [...weeks].sort((a, b) => a.week.localeCompare(b.week));
  const idx = sorted.findIndex((w) => w.week === currentWeek);
  // Use the most recent *complete* week to avoid flagging a week in progress.
  const target = idx > 0 ? sorted[idx - 1] : sorted[sorted.length - 1];
  const tIdx = sorted.indexOf(target);
  const prior = sorted.slice(Math.max(0, tIdx - 3), tIdx);
  if (!target || prior.length < 3) return [];
  const out: Insight[] = [];
  for (const [muscle, n] of Object.entries(target.sets)) {
    const avg = prior.reduce((a, w) => a + (w.sets[muscle] ?? 0), 0) / prior.length;
    if (avg >= 2 && n >= avg * 1.5 && n - avg >= 4) {
      const sets = `${n} weekly sets vs. a ${avg.toFixed(1)}-set average over the previous three weeks.`;
      out.push(
        maintenance.includes(muscle)
          ? {
              key: `volume:${muscle}:${target.week}`,
              severity: "info",
              title: `${labelFor(muscle)} volume rose above your maintenance level`,
              detail: `${sets} You've set ${labelFor(muscle).toLowerCase()} to maintenance in Settings, so this is more than you planned for it.`,
            }
          : {
              key: `volume:${muscle}:${target.week}`,
              severity: "info",
              title: `${labelFor(muscle)} volume increased substantially`,
              detail: `${sets} Monitor recovery before adding more sets.`,
            },
      );
    }
  }
  return out;
}

function labelFor(m: string) {
  return MUSCLE_LABELS[m] ?? m;
}

// ---------- coverage ----------

export interface InsightCoverage {
  /** Sessions with recorded working sets. */
  sessions: number;
  /** Of those, sessions with left and right logged separately: not read by exerciseInsights. */
  sidesSessions: number;
  /** Newest such session, so a dismissed notice returns when another one is logged. */
  newestSidesSessionId: string | null;
  newestSidesDate: string | null;
}

/**
 * exerciseInsights reads only sets logged together. Sessions with left and right recorded separately
 * are skipped (and partly skipped when a session mixes both), so their coverage is reported instead of
 * presenting insights as if they covered everything.
 */
export function insightCoverage(history: ExercisePerformance[]): InsightCoverage {
  const logged = history.filter((h) => h.sets.some((s) => s.kind === "working" && setPerformed(s)));
  const sides = logged.filter((h) => sessionMode(h.sets) !== "together");
  const newest = [...sides].sort((a, b) => b.date.localeCompare(a.date))[0];
  return { sessions: logged.length, sidesSessions: sides.length, newestSidesSessionId: newest?.sessionId ?? null, newestSidesDate: newest?.date ?? null };
}

/** A notice for the insights list when some sessions aren't analysed. */
export function sidesCoverageInsight(perExercise: { name: string; coverage: InsightCoverage }[]): Insight | null {
  const hit = perExercise.filter((e) => e.coverage.sidesSessions > 0);
  if (hit.length === 0) return null;
  const n = hit.reduce((a, e) => a + e.coverage.sidesSessions, 0);
  const names = hit.map((e) => e.name);
  const newest = [...hit].sort((a, b) => (b.coverage.newestSidesDate ?? "").localeCompare(a.coverage.newestSidesDate ?? ""))[0].coverage.newestSidesSessionId;
  return {
    key: "coverage:sides",
    severity: "info",
    title: "Insights don't include left/right sessions yet",
    detail: `${n} exercise session${n === 1 ? "" : "s"} logged with left and right separately (${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}) aren't checked for declines, plateaus or sets to failure. Weekly set counts do include them.`,
    evidenceSessionId: newest ?? undefined,
  };
}
