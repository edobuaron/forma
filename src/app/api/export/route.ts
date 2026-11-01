import { NextResponse, type NextRequest } from "next/server";
import { exportSetRows, SET_CSV_COLUMNS } from "@/lib/data/export";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABLES = [
  "profiles", "exercises", "programs", "program_versions", "workout_templates", "template_exercises",
  "workout_sessions", "session_exercises", "set_logs", "body_measurements", "personal_records", "attachments",
  "template_runs", "session_runs",
] as const;

async function all(db: Awaited<ReturnType<typeof createClient>>, table: string, order = "created_at") {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").order(order).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("|") : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[], cols: string[]) {
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export async function GET(request: NextRequest) {
  const db = await createClient();
  const { data: u } = await db.auth.getUser();
  if (!u.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const fmt = request.nextUrl.searchParams.get("format") ?? "json";
  const type = request.nextUrl.searchParams.get("type") ?? "sets";
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    if (fmt === "json") {
      const data: Record<string, unknown> = { format: "forma-export", version: 1, exported_at: new Date().toISOString(), units: "kg", user_id: u.user.id };
      for (const t of TABLES) data[t] = await all(db, t, t === "profiles" ? "id" : "created_at");
      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="forma-export-${stamp}.json"` },
      });
    }
    if (type === "runs") {
      // One row per completed run of a completed workout. Distance and pace stay empty when no distance was recorded.
      const [runs, sessions] = await Promise.all([all(db, "session_runs"), all(db, "workout_sessions")]);
      const byId = new Map(sessions.map((x) => [x.id as string, x]));
      const rows = runs.filter((r) => r.completed && byId.get(r.session_id as string)?.status === "completed").map((r) => {
        const sess = byId.get(r.session_id as string)!;
        const d = r.distance_m == null ? null : Number(r.distance_m), t = r.duration_s as number;
        const p = (r.prescribed ?? {}) as Record<string, unknown>;
        return {
          date: sess.started_at, workout: sess.name, run: r.name, setting: r.setting, duration_s: t, distance_m: d,
          pace_s_per_km: d ? Math.round(t / (d / 1000)) : null, effort: r.effort, intervals_done: r.intervals_done, notes: r.notes,
          planned_kind: p.target_kind, planned_duration_s: p.target_duration_s, planned_distance_m: p.target_distance_m,
          planned_interval_count: p.interval_count, planned_interval_work_s: p.interval_work_s, planned_interval_work_m: p.interval_work_m,
          planned_interval_recovery_s: p.interval_recovery_s, workout_id: r.session_id, run_id: r.id,
        };
      });
      const cols = Object.keys(rows[0] ?? { date: 0, workout: 0, run: 0, setting: 0, duration_s: 0, distance_m: 0, pace_s_per_km: 0, effort: 0, intervals_done: 0, notes: 0, workout_id: 0, run_id: 0 });
      return new NextResponse(toCsv(rows, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="forma-runs-${stamp}.csv"` } });
    }
    if (type === "body") {
      const rows = await all(db, "body_measurements", "measured_on");
      const cols = ["measured_on", "bodyweight_kg", "waist_cm", "chest_cm", "shoulders_cm", "arms_cm", "thighs_cm", "hips_cm", "notes"];
      return new NextResponse(toCsv(rows, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="forma-body-${stamp}.csv"` } });
    }
    // One row per logged set, joined with workout and exercise
    const [hist, exercises] = await Promise.all([all(db, "set_history", "started_at"), all(db, "exercises")]);
    const exById = new Map(exercises.map((e) => [e.id as string, e]));
    const rows = exportSetRows(hist, exById);
    const cols = SET_CSV_COLUMNS;
    return new NextResponse(toCsv(rows, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="forma-sets-${stamp}.csv"` } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
