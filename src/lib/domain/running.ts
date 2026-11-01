// Running: units, pace, validation, plan text and totals. Pure; no I/O.
//
// Rules:
//  * Distances are stored in metres and durations in seconds. km / miles are a display choice only.
//  * Pace exists only when a valid distance AND a valid duration were recorded. A missing distance stays
//    missing: no pace, no estimate, no calories.
//  * A plan's targets and a run's results are different things and are never mixed: a planned 5 km is
//    not a distance run.
//  * Runs are not lifting. Nothing here produces sets, volume or progression evidence.
import { round } from "./units";

export type DistanceUnit = "km" | "mi";
export type RunSetting = "outdoor" | "treadmill";
export type RunTargetKind = "open" | "time" | "distance" | "intervals";

export const M_PER_MI = 1609.344;
export const MAX_DURATION_S = 86400;
export const MAX_DISTANCE_M = 500000;
/** Faster than this (≈1:31 per km, above sprint world-record speed) is an entry error, not a run. */
export const MAX_SPEED_M_PER_S = 11;

/** The plan for a run, as stored on template_runs and copied into session_runs.prescribed. */
export interface RunPlan {
  target_kind?: RunTargetKind;
  target_duration_s?: number | null;
  target_distance_m?: number | null;
  interval_count?: number | null;
  interval_work_s?: number | null;
  interval_work_m?: number | null;
  interval_recovery_s?: number | null;
  setting?: RunSetting | null;
  optional?: boolean;
  notes?: string | null;
}

/** What was actually run. */
export interface RunResult {
  duration_s: number | null;
  distance_m: number | null;
  effort: number | null;
  intervals_done: number | null;
  setting: RunSetting | null;
}

export const settingLabel: Record<RunSetting, string> = { outdoor: "Outdoor", treadmill: "Treadmill" };

// ---------- units ----------
export function metresToDisplay(m: number, unit: DistanceUnit): number {
  return unit === "km" ? round(m / 1000, 2) : round(m / M_PER_MI, 2);
}

export function displayToMetres(v: number, unit: DistanceUnit): number {
  return round(unit === "km" ? v * 1000 : v * M_PER_MI, 1);
}

/** "5.2 km", "400 m" (short km-mode distances), "3.11 mi". */
export function formatDistance(m: number | null | undefined, unit: DistanceUnit): string {
  if (m == null || !(m > 0)) return "—";
  if (unit === "km" && m < 1000) return `${Math.round(m)} m`;
  return `${metresToDisplay(m, unit)} ${unit}`;
}

/** "25:30", "1:05:00". */
export function formatRunTime(s: number | null | undefined): string {
  if (s == null || !(s > 0)) return "—";
  const t = Math.round(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Short form for plan text: "30 min", "1:30", "45 s", "1 h 10 min". */
export function formatTarget(s: number): string {
  if (s < 60) return `${s} s`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s >= 3600 && s % 60 === 0) return `${Math.floor(s / 3600)} h ${(s % 3600) / 60} min`;
  if (s % 60 === 0) return `${s / 60} min`;
  return formatRunTime(s);
}

/**
 * A typed duration: "25" (minutes), "25:30" (min:s), "1:05:00" (h:min:s), or "25'30". Returns seconds,
 * null for empty, or "invalid". A bare number is minutes; the field shows the result so it can be checked.
 */
export function parseDurationInput(text: string): number | null | "invalid" {
  const t = text.trim().replace(/[’']/g, ":").replace(/"$/, "").replace(/,/g, ".");
  if (!t) return null;
  let s: number;
  if (/^\d+(?:\.\d+)?$/.test(t)) s = Math.round(Number(t) * 60);
  else if (/^\d{1,3}:[0-5]?\d$/.test(t)) { const [m, sec] = t.split(":").map(Number); s = m * 60 + sec; }
  else if (/^\d{1,2}:[0-5]\d:[0-5]\d$/.test(t)) { const [h, m, sec] = t.split(":").map(Number); s = h * 3600 + m * 60 + sec; }
  else return "invalid";
  return s >= 1 && s <= MAX_DURATION_S ? s : "invalid";
}

// ---------- pace ----------
/** Seconds per km or mile, or null unless both a valid distance and a valid duration exist. */
export function paceSeconds(durationS: number | null | undefined, distanceM: number | null | undefined, unit: DistanceUnit): number | null {
  if (durationS == null || distanceM == null) return null;
  if (!(durationS >= 1 && durationS <= MAX_DURATION_S) || !(distanceM > 0 && distanceM <= MAX_DISTANCE_M)) return null;
  if (distanceM > durationS * MAX_SPEED_M_PER_S) return null;
  return durationS / (distanceM / (unit === "km" ? 1000 : M_PER_MI));
}

/** "5:12 /km". Null pace → null (the caller shows nothing, never a dash pretending to be a value). */
export function formatPace(secondsPerUnit: number | null, unit: DistanceUnit): string | null {
  if (secondsPerUnit == null) return null;
  return `${formatRunTime(Math.round(secondsPerUnit))} /${unit}`;
}

// ---------- validation ----------
/** Why a run can't be marked done (or saved in History), or null. */
export function runProblem(r: Pick<RunResult, "duration_s" | "distance_m" | "effort" | "intervals_done">): string | null {
  if (r.duration_s == null) return "Enter how long you ran first.";
  if (!(r.duration_s >= 1 && r.duration_s <= MAX_DURATION_S)) return "Time must be between 1 second and 24 hours.";
  if (r.distance_m != null) {
    if (!(r.distance_m > 0 && r.distance_m <= MAX_DISTANCE_M)) return "Distance must be more than 0 and at most 500 km.";
    if (r.distance_m > r.duration_s * MAX_SPEED_M_PER_S) return "That distance in that time is faster than anyone runs. Check the distance and the time.";
  }
  if (r.effort != null && !(Number.isInteger(r.effort) && r.effort >= 1 && r.effort <= 10)) return "Effort is a whole number from 1 to 10.";
  if (r.intervals_done != null && !(Number.isInteger(r.intervals_done) && r.intervals_done >= 0 && r.intervals_done <= 50)) return "Intervals done must be 0–50.";
  return null;
}

/** Why a planned run is invalid, or null. Mirrors template_runs' check constraints. */
export function planProblem(p: RunPlan): string | null {
  const kind = p.target_kind ?? "open";
  const intIn = (n: number | null | undefined, lo: number, hi: number) => n != null && Number.isInteger(n) && n >= lo && n <= hi;
  if (kind === "time" && !intIn(p.target_duration_s, 1, MAX_DURATION_S)) return "Set the planned time.";
  if (kind === "distance" && !(p.target_distance_m != null && p.target_distance_m > 0 && p.target_distance_m <= MAX_DISTANCE_M)) return "Set the planned distance.";
  if (kind === "intervals") {
    if (!intIn(p.interval_count, 1, 50)) return "Intervals need a repeat count from 1 to 50.";
    const hasTime = p.interval_work_s != null, hasDist = p.interval_work_m != null;
    if (hasTime === hasDist) return "Each interval is either a time or a distance.";
    if (hasTime && !intIn(p.interval_work_s, 1, 7200)) return "Interval time must be 1 s to 2 h.";
    if (hasDist && !(p.interval_work_m! > 0 && p.interval_work_m! <= 50000)) return "Interval distance must be more than 0 and at most 50 km.";
    if (p.interval_recovery_s != null && !intIn(p.interval_recovery_s, 0, 3600)) return "Recovery must be 0 s to 1 h.";
  }
  return null;
}

/** Only the fields of the plan's target kind (the database refuses anything else). */
export function normalizePlan(p: RunPlan): Required<Pick<RunPlan, "target_kind">> & RunPlan {
  const kind = p.target_kind ?? "open";
  const none = { target_duration_s: null, target_distance_m: null, interval_count: null, interval_work_s: null, interval_work_m: null, interval_recovery_s: null };
  if (kind === "time") return { ...p, ...none, target_kind: kind, target_duration_s: p.target_duration_s ?? null };
  if (kind === "distance") return { ...p, ...none, target_kind: kind, target_distance_m: p.target_distance_m ?? null };
  if (kind === "intervals") {
    return {
      ...p, ...none, target_kind: kind, interval_count: p.interval_count ?? null, interval_work_s: p.interval_work_s ?? null,
      interval_work_m: p.interval_work_s != null ? null : p.interval_work_m ?? null, interval_recovery_s: p.interval_recovery_s ?? null,
    };
  }
  return { ...p, ...none, target_kind: "open" };
}

// ---------- plan text ----------
/** "30 min", "5 km", "6 × 400 m · 1:30 recovery", "8 × 1 min · 1 min recovery", or null for no target. */
export function planText(p: RunPlan | null | undefined, unit: DistanceUnit): string | null {
  if (!p) return null;
  switch (p.target_kind) {
    case "time": return p.target_duration_s ? formatTarget(p.target_duration_s) : null;
    case "distance": return p.target_distance_m ? formatDistance(p.target_distance_m, unit) : null;
    case "intervals": {
      if (!p.interval_count) return null;
      const work = p.interval_work_s ? formatTarget(p.interval_work_s) : p.interval_work_m ? formatDistance(p.interval_work_m, unit) : "?";
      const rec = p.interval_recovery_s != null ? ` · ${p.interval_recovery_s ? formatTarget(p.interval_recovery_s) : "no"} recovery` : "";
      return `${p.interval_count} × ${work}${rec}`;
    }
    default: return null;
  }
}

/** "Planned 5 km · treadmill", including the plan's setting. Null when nothing was planned. */
export function planSummary(p: RunPlan | null | undefined, unit: DistanceUnit): string | null {
  const parts = [planText(p, unit), p?.setting ? settingLabel[p.setting].toLowerCase() : null, p?.optional ? "optional" : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "5.2 km · 26:10 · 5:02 /km" for a result: only what was recorded. */
export function resultText(r: Pick<RunResult, "duration_s" | "distance_m">, unit: DistanceUnit): string {
  const pace = formatPace(paceSeconds(r.duration_s, r.distance_m, unit), unit);
  return [r.distance_m ? formatDistance(r.distance_m, unit) : null, r.duration_s ? formatRunTime(r.duration_s) : null, pace].filter(Boolean).join(" · ");
}

// ---------- totals ----------
export interface RunTotals {
  runs: number;
  durationS: number;
  /** Sum over the runs that recorded a distance. */
  distanceM: number;
  /** How many runs recorded a distance; distance totals cover only these. */
  runsWithDistance: number;
  /** Duration of the runs that recorded a distance, for an average pace over the same runs. */
  durationWithDistanceS: number;
}

/** Totals of completed runs. A run without a distance adds to time, never to distance. */
export function runTotals(runs: { completed?: boolean; duration_s: number | null; distance_m: number | null }[]): RunTotals {
  const t: RunTotals = { runs: 0, durationS: 0, distanceM: 0, runsWithDistance: 0, durationWithDistanceS: 0 };
  for (const r of runs) {
    if (r.completed === false || r.duration_s == null) continue;
    const d = r.distance_m == null ? null : Number(r.distance_m);
    t.runs++;
    t.durationS += r.duration_s;
    if (d != null && paceSeconds(r.duration_s, d, "km") != null) {
      t.distanceM += d;
      t.runsWithDistance++;
      t.durationWithDistanceS += r.duration_s;
    }
  }
  return t;
}

/** Average pace over the runs that recorded both distance and time, or null. */
export function averagePace(t: RunTotals, unit: DistanceUnit): number | null {
  return t.runsWithDistance ? paceSeconds(t.durationWithDistanceS, t.distanceM, unit) : null;
}

/** "3 runs · 12.4 km · 1:04:10" — distance qualified when only some runs recorded one. */
export function totalsText(t: RunTotals, unit: DistanceUnit): string {
  if (t.runs === 0) return "No runs";
  const dist = t.runsWithDistance === 0 ? null
    : t.runsWithDistance < t.runs ? `${formatDistance(t.distanceM, unit)} (${t.runsWithDistance} of ${t.runs} with distance)`
    : formatDistance(t.distanceM, unit);
  return [`${t.runs} run${t.runs === 1 ? "" : "s"}`, dist, formatRunTime(t.durationS)].filter(Boolean).join(" · ");
}
