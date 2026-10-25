// Data access layer — writes. Used from client components (RLS enforces ownership).
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectPRs } from "@/lib/domain/prs";
import { completedSetHistory, groupHistory } from "./queries";
import { toExerciseConfig, type ExerciseRow, type ProfileRow } from "./types";

type DB = SupabaseClient;

function ok<T>(res: { data: T | null; error: { message: string; details?: string } | null }): T {
  if (res.error) throw Object.assign(new Error(res.error.message), { details: res.error.details });
  return res.data as T;
}

/** Start a workout now, or log one for a past day when `startedAt` is given. */
export async function startWorkout(db: DB, templateId: string | null, opts: { name?: string; startedAt?: Date } = {}): Promise<string> {
  const res = await db.rpc("start_workout_on", {
    p_template_id: templateId, p_name: opts.name ?? null, p_started_at: opts.startedAt?.toISOString() ?? null,
  });
  if (res.error?.message === "workout_in_progress") {
    const existing = res.error.details;
    throw Object.assign(new Error("A workout is already in progress."), { code: "in_progress", sessionId: existing });
  }
  if (res.error?.message === "future_date") throw new Error("Workouts can't be logged for a future day.");
  return ok(res) as string;
}

export async function finishWorkout(db: DB, sessionId: string, notes: string | null, endedAt = new Date()) {
  // Uncompleted sets are not part of the record.
  ok(await db.from("set_logs").delete().eq("session_id", sessionId).eq("completed", false));
  ok(await db.from("workout_sessions").update({ status: "completed", ended_at: endedAt.toISOString(), notes }).eq("id", sessionId));
}

export async function discardWorkout(db: DB, sessionId: string) {
  ok(await db.from("workout_sessions").delete().eq("id", sessionId));
}

export async function deleteSession(db: DB, sessionId: string) {
  ok(await db.from("workout_sessions").delete().eq("id", sessionId));
}

/**
 * Rebuild personal records for the given exercises from their full history.
 * Records are derived data, so this is always safe to re-run (e.g. after correcting a past workout).
 */
export async function recomputeRecords(db: DB, exercises: ExerciseRow[]) {
  if (exercises.length === 0) return;
  const ids = exercises.map((e) => e.id);
  const rows = await completedSetHistory(db, { exerciseIds: ids });
  const byEx = groupHistory(rows);
  const inserts: Record<string, unknown>[] = [];
  for (const exRow of exercises) {
    const ex = toExerciseConfig(exRow);
    const sessions = [...(byEx.get(ex.id) ?? [])].reverse(); // oldest first
    const prior = [] as (typeof sessions)[number]["sets"];
    for (const s of sessions) {
      for (const pr of detectPRs(ex, s.sets, prior)) {
        inserts.push({
          exercise_id: ex.id, session_id: s.sessionId, type: pr.type, value: pr.value,
          load_kg: pr.loadKg, reps: pr.reps, previous: pr.previous, achieved_at: s.date,
        });
      }
      prior.push(...s.sets);
    }
  }
  ok(await db.from("personal_records").delete().in("exercise_id", ids));
  if (inserts.length) ok(await db.from("personal_records").insert(inserts));
}

export async function updateProfile(db: DB, id: string, patch: Partial<ProfileRow>) {
  ok(await db.from("profiles").update(patch).eq("id", id));
}

export async function dismissRecommendation(db: DB, ruleKey: string, evidenceSessionId: string | null) {
  ok(await db.from("dismissed_recommendations").upsert(
    { rule_key: ruleKey, evidence_session_id: evidenceSessionId },
    { onConflict: "user_id,rule_key,evidence_session_id", ignoreDuplicates: true },
  ));
}

// ---------- exercises ----------
export type ExerciseInput = Omit<ExerciseRow, "id" | "user_id" | "created_at" | "updated_at" | "archived_at" | "slug"> & { slug?: string };

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 60) || "exercise";
}

export async function createExercise(db: DB, input: ExerciseInput): Promise<ExerciseRow> {
  const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 6)}`;
  return ok(await db.from("exercises").insert({ ...input, slug }).select().single()) as ExerciseRow;
}

export async function updateExercise(db: DB, id: string, patch: Partial<ExerciseInput>) {
  ok(await db.from("exercises").update(patch).eq("id", id));
}

export async function archiveExercise(db: DB, id: string, archived: boolean) {
  ok(await db.from("exercises").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id));
}

// ---------- programs & templates ----------
export async function createProgram(db: DB, name: string) {
  return ok(await db.from("programs").insert({ name }).select().single()) as { id: string };
}

export async function updateProgram(db: DB, id: string, patch: { name?: string; description?: string | null }) {
  ok(await db.from("programs").update(patch).eq("id", id));
}

export async function setActiveProgram(db: DB, id: string) {
  ok(await db.from("programs").update({ is_active: false }).eq("is_active", true));
  ok(await db.from("programs").update({ is_active: true }).eq("id", id));
}

export async function archiveProgram(db: DB, id: string) {
  ok(await db.from("programs").update({ archived_at: new Date().toISOString(), is_active: false }).eq("id", id));
}

export async function snapshotProgram(db: DB, id: string, note?: string) {
  return ok(await db.rpc("snapshot_program", { pid: id, note: note ?? null })) as number;
}

export async function duplicateProgram(db: DB, id: string): Promise<string> {
  const src = ok(await db.from("programs").select("*, templates:workout_templates(*, exercises:template_exercises(*))").eq("id", id).single()) as {
    name: string; description: string | null;
    templates: { name: string; day_of_week: number | null; position: number; notes: string | null; warmup_notes: string | null;
      exercises: { exercise_id: string; position: number; sets: number; rep_min: number; rep_max: number; rest_s: number; target_rir: number | null; optional: boolean; notes: string | null }[] }[];
  };
  const p = ok(await db.from("programs").insert({ name: `${src.name} (copy)`, description: src.description }).select("id").single()) as { id: string };
  for (const t of src.templates) {
    const nt = ok(await db.from("workout_templates").insert({
      program_id: p.id, name: t.name, day_of_week: t.day_of_week, position: t.position, notes: t.notes, warmup_notes: t.warmup_notes,
    }).select("id").single()) as { id: string };
    if (t.exercises.length) {
      ok(await db.from("template_exercises").insert(t.exercises.map((e) => ({ ...e, template_id: nt.id }))));
    }
  }
  await snapshotProgram(db, p.id, "Duplicated");
  return p.id;
}

export async function createTemplate(db: DB, programId: string, name: string, position: number) {
  return ok(await db.from("workout_templates").insert({ program_id: programId, name, position }).select().single()) as { id: string };
}

export async function duplicateTemplate(db: DB, templateId: string) {
  const t = ok(await db.from("workout_templates").select("*, exercises:template_exercises(*)").eq("id", templateId).single()) as {
    program_id: string; name: string; position: number; notes: string | null; warmup_notes: string | null;
    exercises: Record<string, unknown>[];
  };
  const nt = ok(await db.from("workout_templates").insert({
    program_id: t.program_id, name: `${t.name} (copy)`, position: t.position + 1, notes: t.notes, warmup_notes: t.warmup_notes,
  }).select("id").single()) as { id: string };
  if (t.exercises.length) {
    ok(await db.from("template_exercises").insert(t.exercises.map(({ id: _id, created_at: _c, updated_at: _u, template_id: _t, ...e }) => ({ ...e, template_id: nt.id }))));
  }
  return nt.id;
}

export async function updateTemplate(db: DB, id: string, patch: { name?: string; day_of_week?: number | null; notes?: string | null; warmup_notes?: string | null; position?: number }) {
  ok(await db.from("workout_templates").update(patch).eq("id", id));
}

export async function deleteTemplate(db: DB, id: string) {
  ok(await db.from("workout_templates").delete().eq("id", id));
}

export interface TemplateExerciseInput {
  id?: string;
  template_id: string;
  exercise_id: string;
  position: number;
  sets: number;
  rep_min: number;
  rep_max: number;
  rest_s: number;
  target_rir: number | null;
  optional: boolean;
  notes: string | null;
}

export async function upsertTemplateExercises(db: DB, rows: TemplateExerciseInput[]) {
  if (rows.length) ok(await db.from("template_exercises").upsert(rows));
}

export async function deleteTemplateExercise(db: DB, id: string) {
  ok(await db.from("template_exercises").delete().eq("id", id));
}

// ---------- body ----------
export async function upsertMeasurement(db: DB, row: Record<string, unknown>) {
  ok(await db.from("body_measurements").upsert(row, { onConflict: "user_id,measured_on" }));
}

export async function deleteMeasurement(db: DB, id: string) {
  ok(await db.from("body_measurements").delete().eq("id", id));
}
