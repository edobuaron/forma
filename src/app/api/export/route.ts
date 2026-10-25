import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABLES = [
  "profiles", "exercises", "programs", "program_versions", "workout_templates", "template_exercises",
  "workout_sessions", "session_exercises", "set_logs", "body_measurements", "personal_records",
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
    if (type === "body") {
      const rows = await all(db, "body_measurements", "measured_on");
      const cols = ["measured_on", "bodyweight_kg", "waist_cm", "chest_cm", "shoulders_cm", "arms_cm", "thighs_cm", "hips_cm", "notes"];
      return new NextResponse(toCsv(rows, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="forma-body-${stamp}.csv"` } });
    }
    // One row per logged set, joined with workout and exercise
    const [hist, exercises] = await Promise.all([all(db, "set_history", "started_at"), all(db, "exercises")]);
    const exById = new Map(exercises.map((e) => [e.id as string, e]));
    const rows = hist.filter((h) => h.status === "completed" && h.completed).map((h) => {
      const e = exById.get(h.exercise_id as string) ?? {};
      return {
        date: h.started_at, workout: h.session_name, workout_id: h.session_id, exercise: e.name, exercise_id: h.exercise_id,
        equipment: e.equipment, load_type: e.load_type, set_number: (h.position as number) + 1, kind: h.kind,
        weight_kg: h.weight_kg, assistance_kg: h.assistance_kg, reps: h.reps, rir: h.rir, bodyweight_kg: h.bodyweight_kg,
        prescribed_rep_min: (h.prescribed as { rep_min?: number })?.rep_min, prescribed_rep_max: (h.prescribed as { rep_max?: number })?.rep_max,
        set_id: h.id,
      };
    });
    const cols = ["date", "workout", "exercise", "set_number", "kind", "weight_kg", "assistance_kg", "reps", "rir", "bodyweight_kg", "equipment", "load_type", "prescribed_rep_min", "prescribed_rep_max", "workout_id", "exercise_id", "set_id"];
    return new NextResponse(toCsv(rows, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="forma-sets-${stamp}.csv"` } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
