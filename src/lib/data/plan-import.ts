// Plan import: saving drafts and creating the program (migration 014). Used from client components;
// RLS keeps drafts private, and create_program_from_import() is the only path that writes a program.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProgramPayload } from "@/lib/plan-import/review";
import type { PlanDraft } from "@/lib/plan-import/types";

type DB = SupabaseClient;

export interface StoredDraft {
  id: string;
  source_kind: PlanDraft["sourceKind"];
  source_name: string | null;
  draft: PlanDraft;
  updated_at: string;
  expires_at: string;
}

/** Removes expired drafts (retention: 30 days after the last change), then lists the user's open drafts. */
export async function listDrafts(db: DB): Promise<StoredDraft[]> {
  await db.rpc("purge_expired_plan_imports");
  const res = await db.from("plan_imports").select("id, source_kind, source_name, draft, updated_at, expires_at")
    .eq("status", "draft").order("updated_at", { ascending: false }).limit(5);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []).filter((r) => r.draft && (r.draft as PlanDraft).version === 1) as StoredDraft[];
}

/** Autosave. Only drafts are writable; a created import can't be turned back into one. */
export async function saveDraft(db: DB, draft: PlanDraft) {
  const res = await db.from("plan_imports").upsert({
    id: draft.importId, source_kind: draft.sourceKind, source_name: draft.sourceName?.slice(0, 200) ?? null, draft,
  });
  if (res.error) throw new Error(res.error.message);
}

export async function deleteDraft(db: DB, importId: string) {
  const res = await db.from("plan_imports").delete().eq("id", importId);
  if (res.error) throw new Error(res.error.message);
}

const CREATE_ERRORS: Record<string, string> = {
  invalid_import: "This import can't be used. Start a new one.",
  program_deleted: "The program from this import was deleted. Start a new import to create it again.",
  invalid_program_name: "Give the program a name (up to 120 characters).",
  invalid_workouts: "A program needs 1–30 workouts.",
  invalid_workout_name: "Workout {d} needs a name.",
  invalid_exercises: "Workout {d} needs 1–40 exercises.",
  unknown_exercise: "Exercise {d} isn't in your library any more. Choose it again.",
  invalid_prescription: "Exercise {d} has a value out of range.",
};

/**
 * Create the program. Atomic and safe to retry: the import id makes a repeated call (double tap, lost
 * response) return the program the first call created.
 */
export async function createProgramFromImport(db: DB, importId: string, program: ProgramPayload, makeActive: boolean) {
  const res = await db.rpc("create_program_from_import", { p_import_id: importId, p_program: program, p_make_active: makeActive });
  if (res.error) {
    const template = CREATE_ERRORS[res.error.message];
    // details is "workout.exercise" (1-based); shown as "2.3" so the user can find the row.
    throw new Error(template ? template.replace("{d}", res.error.details ?? "") : res.error.message);
  }
  return res.data as { program_id: string; status: "created" | "already_created" };
}
