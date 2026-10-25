import type { ExerciseConfig, ExercisePerformance, LoggedSet, Prescription } from "../types";

export const ex = (o: Partial<ExerciseConfig> = {}): ExerciseConfig => ({
  id: "ex1",
  name: "Incline Smith Press",
  category: "compound",
  loadType: "external",
  progression: "double_progression",
  incrementKg: 2.5,
  minLoadKg: 0,
  availableLoadsKg: null,
  e1rmEligible: true,
  ...o,
});

export const rx = (o: Partial<Prescription> = {}): Prescription => ({
  sets: 3, repMin: 6, repMax: 10, restS: 120, targetRir: null, ...o,
});

export const set = (weightKg: number | null, reps: number | null, o: Partial<LoggedSet> = {}): LoggedSet => ({
  kind: "working", weightKg, reps, rir: null, assistanceKg: null, completed: true, ...o,
});

let n = 0;
export const perf = (sets: LoggedSet[], daysAgo = 0, o: Partial<ExercisePerformance> = {}): ExercisePerformance => ({
  sessionId: `s${++n}`,
  date: new Date(Date.UTC(2026, 9, 25) - daysAgo * 86400000).toISOString(),
  sets,
  prescription: null,
  ...o,
});
