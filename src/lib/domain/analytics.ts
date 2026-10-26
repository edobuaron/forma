import { setE1rm } from "./e1rm";
import { effectiveLoad, sameLoad, workingSets } from "./sets";
import type { ExerciseConfig, ExercisePerformance, LoggedSet } from "./types";

/** Per-session aggregate for one exercise — the unit plotted on progress charts. */
export interface SessionPoint {
  sessionId: string;
  date: string;
  topLoadKg: number; // heaviest working-set effective load
  repsAtTop: number; // best reps at that load
  bestE1rmKg: number | null; // null when not appropriate
  totalReps: number;
  volumeKg: number; // Σ load × reps (external load only)
  workingSets: number;
}

/** Aggregate each session to one point. We never connect individual sets across sessions. */
export function sessionPoints(ex: ExerciseConfig, history: ExercisePerformance[]): SessionPoint[] {
  return history
    .map((h) => {
      const ws = workingSets(h.sets, ex);
      if (ws.length === 0) return null;
      const loads = ws.map((s) => effectiveLoad(s, ex));
      const top = Math.max(...loads);
      const repsAtTop = Math.max(...ws.filter((s) => sameLoad(effectiveLoad(s, ex), top)).map((s) => s.reps!));
      const e1rms = ws.map((s) => setE1rm(s, ex)).filter((v): v is number => v != null);
      return {
        sessionId: h.sessionId,
        date: h.date,
        topLoadKg: top,
        repsAtTop,
        bestE1rmKg: e1rms.length ? Math.round(Math.max(...e1rms) * 10) / 10 : null,
        totalReps: ws.reduce((a, s) => a + s.reps!, 0),
        volumeKg: Math.round(ws.reduce((a, s) => a + Math.max(0, s.weightKg ?? 0) * s.reps!, 0)),
        workingSets: ws.length,
      } satisfies SessionPoint;
    })
    .filter((p): p is SessionPoint => p != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Best reps achieved at each load ever used — a rep-PR table. */
export function bestRepsByLoad(ex: ExerciseConfig, sets: LoggedSet[]): { loadKg: number; reps: number }[] {
  const m = new Map<number, number>();
  for (const s of workingSets(sets, ex)) {
    const l = effectiveLoad(s, ex);
    m.set(l, Math.max(m.get(l) ?? 0, s.reps!));
  }
  return [...m.entries()].map(([loadKg, reps]) => ({ loadKg, reps })).sort((a, b) => b.loadKg - a.loadKg);
}

/** Highest load lifted for at least `minReps` reps (rep-range strength). */
export function bestLoadForReps(ex: ExerciseConfig, sets: LoggedSet[], minReps: number): number | null {
  const loads = workingSets(sets, ex).filter((s) => s.reps! >= minReps).map((s) => effectiveLoad(s, ex));
  return loads.length ? Math.max(...loads) : null;
}

/** ISO week key (Monday start) as yyyy-mm-dd of the Monday, in local time. */
export function weekStart(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export interface MuscleSet {
  date: string;
  primary: string[];
  secondary: string[];
}

/** Weekly working sets per muscle: primary muscles count 1, secondary 0.5. */
export function weeklySetsPerMuscle(items: MuscleSet[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const it of items) {
    const wk = weekStart(new Date(it.date));
    const m = out.get(wk) ?? new Map<string, number>();
    for (const p of it.primary) m.set(p, (m.get(p) ?? 0) + 1);
    for (const s of it.secondary) m.set(s, (m.get(s) ?? 0) + 0.5);
    out.set(wk, m);
  }
  return out;
}

export const MUSCLE_LABELS: Record<string, string> = {
  chest: "Chest",
  upper_chest: "Upper chest",
  front_delts: "Front delts",
  side_delts: "Side delts",
  rear_delts: "Rear delts",
  lats: "Lats",
  upper_back: "Upper back",
  traps: "Traps",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  spinal_erectors: "Spinal erectors",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

export const TIMEFRAMES = [
  { key: "4w", label: "4W", days: 28 },
  { key: "8w", label: "8W", days: 56 },
  { key: "3m", label: "3M", days: 91 },
  { key: "6m", label: "6M", days: 182 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null },
] as const;
export type TimeframeKey = (typeof TIMEFRAMES)[number]["key"];

export function timeframeStart(key: TimeframeKey, now = new Date()): Date | null {
  const tf = TIMEFRAMES.find((t) => t.key === key);
  if (!tf || tf.days == null) return null;
  return new Date(now.getTime() - tf.days * 86400000);
}
