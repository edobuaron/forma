// Composes dashboard data from the data layer + domain logic. Server-side only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionPoints, weekStart, weeklySetsPerMuscle } from "@/lib/domain/analytics";
import { consistencyInsight, exerciseInsights, missedSessions, volumeInsights, type Insight } from "@/lib/domain/insights";
import { recommend, type Recommendation } from "@/lib/domain/progression";
import type { ExerciseConfig } from "@/lib/domain/types";
import {
  completedSetHistory, getActiveProgram, getProfile, groupHistory, listDismissed, listExercises, listSessions,
  recentHistory, recentRecords, type TemplateWithExercises,
} from "./queries";
import { toExerciseConfig, toPrescription, type ExerciseRow } from "./types";

export async function loadDashboard(db: SupabaseClient) {
  const now = new Date();
  const since = new Date(now.getTime() - 12 * 7 * 86400000).toISOString();
  const [profile, program, exercises, recent, records, rows, dismissedRows] = await Promise.all([
    getProfile(db),
    getActiveProgram(db),
    listExercises(db, { includeArchived: true }),
    listSessions(db, { limit: 40 }),
    recentRecords(db, 5),
    completedSetHistory(db, { since }),
    listDismissed(db),
  ]);
  const dismissed = new Set(dismissedRows.map((d) => `${d.rule_key}:${d.evidence_session_id ?? ""}`));
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const templates = program?.templates ?? [];

  // ----- schedule -----
  // Nothing counts as "missed" before the account existed.
  const created = new Date(profile.created_at);
  const trackingStart = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const thisWeek = weekStart(now);
  const weekSessions = recent.filter((s) => weekStart(new Date(s.started_at)) === thisWeek);
  const doneToday = recent.some((s) => new Date(s.started_at).toDateString() === now.toDateString());
  const scheduled = templates.filter((t) => t.day_of_week != null);
  let next: TemplateWithExercises | null = null;
  for (let i = doneToday ? 1 : 0; i < 8 && !next; i++) {
    const dow = (now.getDay() + i) % 7;
    next = scheduled.find((t) => t.day_of_week === dow) ?? null;
  }
  next ??= templates[0] ?? null;

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + i);
    const tpl = scheduled.find((t) => t.day_of_week === d.getDay()) ?? null;
    const sessions = weekSessions.filter((s) => new Date(s.started_at).toDateString() === d.toDateString());
    const isPast = d < new Date(now.getFullYear(), now.getMonth(), now.getDate()) && d >= trackingStart;
    return {
      date: d.toISOString(),
      isToday: d.toDateString() === now.toDateString(),
      template: tpl ? { id: tpl.id, name: tpl.name } : null,
      done: sessions.map((s) => ({ id: s.id, name: s.name })),
      missed: !!tpl && isPast && sessions.length === 0,
    };
  });

  // ----- weekly volume & sets (last 8 weeks) -----
  const weeks: string[] = [];
  for (let i = 7; i >= 0; i--) weeks.push(weekStart(new Date(now.getTime() - i * 7 * 86400000)));
  const working = rows.filter((r) => r.kind === "working" && (r.reps ?? 0) > 0);
  const volumeByWeek = new Map<string, { volume: number; sets: number }>();
  for (const r of working) {
    const wk = weekStart(new Date(r.started_at));
    const v = volumeByWeek.get(wk) ?? { volume: 0, sets: 0 };
    v.volume += Math.max(0, Number(r.weight_kg ?? 0)) * (r.reps ?? 0);
    v.sets += 1;
    volumeByWeek.set(wk, v);
  }
  const weekly = weeks.map((w) => ({ week: w, volume: Math.round(volumeByWeek.get(w)?.volume ?? 0), sets: volumeByWeek.get(w)?.sets ?? 0 }));

  const muscleWeeks = weeklySetsPerMuscle(
    working.map((r) => {
      const e = exById.get(r.exercise_id);
      return { date: r.started_at, primary: e?.primary_muscles ?? [], secondary: e?.secondary_muscles ?? [] };
    }),
  );

  // ----- strength highlights (8 weeks) -----
  const grouped = groupHistory(rows);
  const highlightSince = new Date(now.getTime() - 8 * 7 * 86400000).toISOString();
  const highlights: { exercise: ExerciseRow; metric: "e1rm" | "load" | "reps"; from: number; to: number; fromReps?: number; toReps?: number; sessions: number }[] = [];
  for (const [exId, perf] of grouped) {
    const e = exById.get(exId);
    if (!e || e.category === "skill") continue;
    const cfg = toExerciseConfig(e);
    const pts = sessionPoints(cfg, perf).filter((p) => p.date >= highlightSince);
    if (pts.length < 2) continue;
    const a = pts[0], b = pts[pts.length - 1];
    if (cfg.e1rmEligible && a.bestE1rmKg && b.bestE1rmKg && b.bestE1rmKg > a.bestE1rmKg) {
      highlights.push({ exercise: e, metric: "e1rm", from: a.bestE1rmKg, to: b.bestE1rmKg, sessions: pts.length });
    } else if (b.topLoadKg > a.topLoadKg) {
      highlights.push({ exercise: e, metric: "load", from: a.topLoadKg, to: b.topLoadKg, fromReps: a.repsAtTop, toReps: b.repsAtTop, sessions: pts.length });
    } else if (b.topLoadKg === a.topLoadKg && b.repsAtTop > a.repsAtTop) {
      highlights.push({ exercise: e, metric: "reps", from: a.repsAtTop, to: b.repsAtTop, fromReps: a.repsAtTop, toReps: b.repsAtTop, sessions: pts.length });
    }
  }
  highlights.sort((x, y) => (y.to - y.from) / Math.max(1, y.from) - (x.to - x.from) / Math.max(1, x.from));

  // ----- next-session recommendations -----
  let recs: { exercise: ExerciseRow; cfg: ExerciseConfig; rec: Recommendation }[] = [];
  if (next) {
    const ids = next.exercises.map((e) => e.exercise_id);
    const h = await recentHistory(db, ids, 6);
    recs = next.exercises.map((te) => {
      const cfg = toExerciseConfig(te.exercise);
      return {
        exercise: te.exercise,
        cfg,
        rec: recommend(cfg, toPrescription({ sets: te.sets, rep_min: te.rep_min, rep_max: te.rep_max, rest_s: te.rest_s }), h.byExercise.get(te.exercise_id) ?? [], { conservative: profile.progression_conservative }),
      };
    }).filter((r) => r.rec.action !== "first_time" && r.rec.action !== "skill" && !dismissed.has(`progression:${r.exercise.id}:${r.rec.evidenceSessionId ?? ""}`));
  }
  const priority: Record<string, number> = { increase_load: 0, hold_below: 1, consider_reduce: 2, hold_effort: 3, hold_confirm: 4, add_reps_or_load: 5, hold_build_reps: 6, hold_incomplete: 7, skill: 9, first_time: 10 };
  recs.sort((a, b) => priority[a.rec.action] - priority[b.rec.action]);

  // ----- insights -----
  const insights: Insight[] = [];
  for (const [exId, perf] of grouped) {
    const e = exById.get(exId);
    if (e) insights.push(...exerciseInsights(toExerciseConfig(e), perf));
  }
  insights.push(
    ...volumeInsights(
      [...muscleWeeks.entries()].map(([week, m]) => ({ week, sets: Object.fromEntries(m) })),
      thisWeek,
    ),
  );
  const scheduledDays = scheduled.map((t) => t.day_of_week!) as number[];
  const missed = missedSessions(scheduledDays, recent.map((s) => s.started_at), now, trackingStart);
  const ci = consistencyInsight(missed, scheduledDays.length * 2);
  if (ci) insights.push(ci);
  const visibleInsights = insights.filter((i) => !dismissed.has(`insight:${i.key}:${i.evidenceSessionId ?? ""}`));
  const enoughData = grouped.size > 0 && recent.length >= 6;

  return {
    profile,
    program,
    next,
    week,
    weekCompleted: weekSessions.length,
    weekScheduled: scheduled.length,
    recent: recent.slice(0, 5),
    records,
    weekly,
    highlights: highlights.slice(0, 4),
    recs: recs.slice(0, 4),
    insights: visibleInsights.slice(0, 4),
    enoughData,
    totalSessions: recent.length,
  };
}
