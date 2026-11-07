// Rest timer state. Remaining time is always derived from a stored deadline and the wall clock,
// never from a counter, so backgrounding, reloads and a suspended tab come back with the right time.
// Pure functions, no I/O.

export type RestSource = "prescribed" | "exercise" | "default" | "override" | "manual";

export interface RestState {
  /** Epoch ms when the rest ends. The single source of truth for the time left. */
  endAt: number;
  /** Epoch ms when it started; with endAt it gives the length shown by the progress bar. */
  startedAt: number;
  /** Length in seconds (endAt − startedAt), kept for older stored states and the progress bar. */
  duration: number;
  label: string;
  /** Session exercise this rest follows; null for a manual timer. */
  itemId?: string | null;
  source?: RestSource;
  /** Rest between the two sides of one set, started only when the user turned that on. */
  betweenSides?: boolean;
}

/** Whole seconds left, never negative. */
export function remainingS(r: RestState, now: number): number {
  return Math.max(0, Math.ceil((r.endAt - now) / 1000));
}

export function progress(r: RestState, now: number): number {
  const total = Math.max(1, r.endAt - r.startedAt);
  return Math.max(0, Math.min(1, (now - r.startedAt) / total));
}

export function startRest(seconds: number, now: number, extra: Omit<RestState, "endAt" | "startedAt" | "duration">): RestState {
  const s = Math.max(1, Math.round(seconds));
  return { ...extra, startedAt: now, endAt: now + s * 1000, duration: s };
}

/**
 * Add or take away time. Builds on the stored deadline (so rapid taps each count once), never moves the
 * end before now, and adding time to a finished rest restarts from now.
 */
export function adjustRest(r: RestState, deltaS: number, now: number): RestState {
  const base = Math.max(now, r.endAt);
  const endAt = deltaS >= 0 ? base + deltaS * 1000 : Math.max(now, r.endAt + deltaS * 1000);
  const startedAt = Math.min(r.startedAt, endAt - 1000);
  return { ...r, endAt, startedAt, duration: Math.round((endAt - startedAt) / 1000) };
}

/** Use a new length for this rest, counted from when it started. */
export function setRestLength(r: RestState, seconds: number, now: number, source: RestSource = "override"): RestState {
  const endAt = Math.max(now, r.startedAt + Math.max(1, seconds) * 1000);
  return { ...r, endAt, duration: Math.round((endAt - r.startedAt) / 1000), source };
}

/** How long a finished rest keeps showing "Rest complete" after a reload or return to the app. */
export const DONE_GRACE_MS = 20_000;

/** A stored rest, if it is still worth showing. Older stored states (no startedAt) are upgraded. */
export function restoreRest(raw: unknown, now: number): RestState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<RestState>;
  if (typeof r.endAt !== "number" || !Number.isFinite(r.endAt)) return null;
  if (r.endAt < now - DONE_GRACE_MS) return null;
  const duration = typeof r.duration === "number" && r.duration > 0 ? r.duration : 60;
  const startedAt = typeof r.startedAt === "number" ? r.startedAt : r.endAt - duration * 1000;
  // A deadline far in the future is not a rest (bad clock or corrupted value).
  if (r.endAt - now > 60 * 60_000) return null;
  return { ...r, endAt: r.endAt, startedAt, duration, label: typeof r.label === "string" ? r.label : "Rest" } as RestState;
}

/**
 * The rest to use after an exercise's set: an explicit override for this workout wins, then the
 * prescription copied into the workout, then the exercise's default, then the profile's.
 */
export function restFor(opts: { overrideS?: number | null; prescribedS?: number | null; exerciseS?: number | null; profileS: number }): { seconds: number; source: RestSource } {
  if (opts.overrideS != null && opts.overrideS > 0) return { seconds: opts.overrideS, source: "override" };
  if (opts.prescribedS != null && opts.prescribedS > 0) return { seconds: opts.prescribedS, source: "prescribed" };
  if (opts.exerciseS != null && opts.exerciseS > 0) return { seconds: opts.exerciseS, source: "exercise" };
  return { seconds: opts.profileS, source: "default" };
}

export const restSourceLabel: Record<RestSource, string> = {
  prescribed: "Planned rest",
  exercise: "Exercise default",
  default: "Your default rest",
  override: "Changed for this workout",
  manual: "Manual timer",
};
