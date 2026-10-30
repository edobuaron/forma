import { NextResponse, type NextRequest } from "next/server";
import { exportSetRows, SET_CSV_COLUMNS } from "@/lib/data/export";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TABLES = [
  "profiles", "exercises", "programs", "program_versions", "workout_templates", "template_exercises",
  "workout_sessions", "session_exercises", "set_logs", "body_measurements", "personal_records", "attachments",
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
    const rows = exportSetRows(hist, exById);
    const cols = SET_CSV_COLUMNS;
    return new NextResponse(toCsv(rows, cols), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="forma-sets-${stamp}.csv"` } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
