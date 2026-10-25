// Data access layer. Every database read goes through here so the UI never builds queries itself.
// Functions take a SupabaseClient, so they work on the server (RSC) and in the browser alike.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExercisePerformance } from "@/lib/domain/types";
import {
  toLoggedSet, toPrescription,
  type BodyMeasurementRow, type ExerciseRow, type PersonalRecordRow, type ProfileRow, type ProgramRow,
  type SessionExerciseRow, type SessionRow, type SetHistoryRow, type SetLogRow, type TemplateExerciseRow,
  type TemplateRow,
} from "./types";

type DB = SupabaseClient;

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Page through results to avoid PostgREST's default row cap. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const rows = check(await build(from, from + page - 1)) ?? [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

// ---------- profile ----------
export async function getProfile(db: DB): Promise<ProfileRow> {
  const { data: u } = await db.auth.getUser();
  const res = await db.from("profiles").select("*").eq("id", u.user!.id).maybeSingle();
  const row = check(res) as ProfileRow | null;
  if (row) return row;
  await db.rpc("ensure_seeded");
  return check(await db.from("profiles").select("*").eq("id", u.user!.id).single()) as ProfileRow;
}

// ---------- exercises ----------
export async function listExercises(db: DB, opts: { includeArchived?: boolean } = {}): Promise<ExerciseRow[]> {
  let q = db.from("exercises").select("*").order("name");
  if (!opts.includeArchived) q = q.is("archived_at", null);
  return check(await q) as ExerciseRow[];
}

export async function getExercise(db: DB, id: string): Promise<ExerciseRow | null> {
  return check(await db.from("exercises").select("*").eq("id", id).maybeSingle()) as ExerciseRow | null;
}

// ---------- programs ----------
export interface TemplateWithExercises extends TemplateRow {
  exercises: (TemplateExerciseRow & { exercise: ExerciseRow })[];
}
export interface ProgramFull extends ProgramRow {
  templates: TemplateWithExercises[];
}

const PROGRAM_SELECT = "*, templates:workout_templates(*, exercises:template_exercises(*, exercise:exercises(*)))";

function sortProgram(p: ProgramFull): ProgramFull {
  p.templates.sort((a, b) => a.position - b.position);
  p.templates.forEach((t) => t.exercises.sort((a, b) => a.position - b.position));
  return p;
}

export async function listPrograms(db: DB): Promise<ProgramRow[]> {
  return check(await db.from("programs").select("*").is("archived_at", null).order("is_active", { ascending: false }).order("created_at")) as ProgramRow[];
}

export async function getProgram(db: DB, id: string): Promise<ProgramFull | null> {
  const p = check(await db.from("programs").select(PROGRAM_SELECT).eq("id", id).maybeSingle()) as ProgramFull | null;
  return p ? sortProgram(p) : null;
}

export async function getActiveProgram(db: DB): Promise<ProgramFull | null> {
  let p = check(await db.from("programs").select(PROGRAM_SELECT).eq("is_active", true).is("archived_at", null).maybeSingle()) as ProgramFull | null;
  if (!p) {
    const any = check(await db.from("programs").select("id").is("archived_at", null).limit(1)) as { id: string }[];
    if (any.length === 0) {
      await db.rpc("ensure_seeded");
      p = check(await db.from("programs").select(PROGRAM_SELECT).eq("is_active", true).maybeSingle()) as ProgramFull | null;
    }
  }
  return p ? sortProgram(p) : null;
}

export async function getProgramVersions(db: DB, programId: string) {
  return check(await db.from("program_versions").select("id, version, note, created_at").eq("program_id", programId).order("version", { ascending: false })) as { id: string; version: number; note: string | null; created_at: string }[];
}

// ---------- sessions ----------
export interface SessionFull extends SessionRow {
  exercises: (SessionExerciseRow & { exercise: ExerciseRow; sets: SetLogRow[] })[];
}

export async function getInProgressSession(db: DB): Promise<SessionRow | null> {
  return check(await db.from("workout_sessions").select("*").eq("status", "in_progress").maybeSingle()) as SessionRow | null;
}

export async function getSessionFull(db: DB, id: string): Promise<SessionFull | null> {
  const s = check(
    await db.from("workout_sessions")
      .select("*, exercises:session_exercises(*, exercise:exercises!session_exercises_exercise_id_fkey(*), sets:set_logs(*))")
      .eq("id", id).maybeSingle(),
  ) as SessionFull | null;
  if (!s) return null;
  s.exercises.sort((a, b) => a.position - b.position);
  s.exercises.forEach((e) => e.sets.sort((a, b) => a.position - b.position));
  return s;
}

export interface SessionListItem extends SessionRow {
  exercise_count: number;
  set_count: number;
}

export async function listSessions(db: DB, opts: { limit?: number; from?: string; to?: string } = {}): Promise<SessionListItem[]> {
  let q = db.from("workout_sessions")
    .select("*, session_exercises(id), set_logs(id, completed, kind)")
    .eq("status", "completed")
    .order("started_at", { ascending: false });
  if (opts.from) q = q.gte("started_at", opts.from);
  if (opts.to) q = q.lt("started_at", opts.to);
  if (opts.limit) q = q.limit(opts.limit);
  const rows = check(await q) as (SessionRow & { session_exercises: { id: string }[]; set_logs: { completed: boolean; kind: string }[] })[];
  return rows.map(({ session_exercises, set_logs, ...s }) => ({
    ...s,
    exercise_count: session_exercises.length,
    set_count: set_logs.filter((l) => l.completed && l.kind === "working").length,
  }));
}

// ---------- history ----------
/** Group flat history rows into per-session performances, newest first, keyed by exercise. */
export function groupHistory(rows: SetHistoryRow[]): Map<string, ExercisePerformance[]> {
  const byEx = new Map<string, Map<string, ExercisePerformance>>();
  for (const r of rows) {
    const m = byEx.get(r.exercise_id) ?? new Map<string, ExercisePerformance>();
    const p = m.get(r.session_id) ?? {
      sessionId: r.session_id,
      date: r.started_at,
      sets: [],
      prescription: r.prescribed && Object.keys(r.prescribed).length ? toPrescription(r.prescribed) : null,
      bodyweightKg: r.bodyweight_kg == null ? null : Number(r.bodyweight_kg),
    };
    p.sets.push(toLoggedSet(r));
    m.set(r.session_id, p);
    byEx.set(r.exercise_id, m);
  }
  const out = new Map<string, ExercisePerformance[]>();
  for (const [k, m] of byEx) out.set(k, [...m.values()].sort((a, b) => b.date.localeCompare(a.date)));
  return out;
}

export async function recentHistory(db: DB, exerciseIds: string[], sessions = 6, excludeSessionId?: string) {
  if (exerciseIds.length === 0) return { rows: [] as SetHistoryRow[], byExercise: new Map<string, ExercisePerformance[]>() };
  const rows = check(
    await db.rpc("recent_exercise_history", {
      p_exercise_ids: exerciseIds, p_sessions: sessions, p_exclude_session: excludeSessionId ?? null,
    }),
  ) as SetHistoryRow[];
  return { rows, byExercise: groupHistory(rows) };
}

/** All completed sets, optionally since a date and/or for specific exercises. */
export async function completedSetHistory(db: DB, opts: { since?: string | null; exerciseIds?: string[] } = {}): Promise<SetHistoryRow[]> {
  return fetchAll<SetHistoryRow>((from, to) => {
    let q = db.from("set_history").select("*").eq("status", "completed").eq("completed", true);
    if (opts.since) q = q.gte("started_at", opts.since);
    if (opts.exerciseIds) q = q.in("exercise_id", opts.exerciseIds);
    return q.order("started_at", { ascending: true }).order("id").range(from, to);
  });
}

// ---------- records & body ----------
export async function recentRecords(db: DB, limit = 6) {
  return check(
    await db.from("personal_records").select("*, exercise:exercises(id, name, load_type)").order("achieved_at", { ascending: false }).limit(limit),
  ) as (PersonalRecordRow & { exercise: Pick<ExerciseRow, "id" | "name" | "load_type"> })[];
}

export async function exerciseRecords(db: DB, exerciseId: string) {
  return check(await db.from("personal_records").select("*").eq("exercise_id", exerciseId).order("achieved_at", { ascending: false })) as PersonalRecordRow[];
}

export async function sessionRecords(db: DB, sessionId: string) {
  return check(await db.from("personal_records").select("*").eq("session_id", sessionId)) as PersonalRecordRow[];
}

export async function listMeasurements(db: DB): Promise<BodyMeasurementRow[]> {
  return check(await db.from("body_measurements").select("*").order("measured_on", { ascending: false })) as BodyMeasurementRow[];
}

export async function listDismissed(db: DB): Promise<{ rule_key: string; evidence_session_id: string | null }[]> {
  return check(await db.from("dismissed_recommendations").select("rule_key, evidence_session_id")) as { rule_key: string; evidence_session_id: string | null }[];
}

/** Lightweight list of completed session dates (for consistency and calendar stats). */
export async function listSessionDates(db: DB, since?: string | null) {
  return fetchAll<{ id: string; started_at: string; template_id: string | null }>((from, to) => {
    let q = db.from("workout_sessions").select("id, started_at, template_id").eq("status", "completed");
    if (since) q = q.gte("started_at", since);
    return q.order("started_at").range(from, to);
  });
}
