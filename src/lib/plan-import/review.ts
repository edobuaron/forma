// Editing a draft in the review screen, validating it, and turning it into what the server receives. Pure.
import type { DraftExercise, DraftValues, ExerciseChoice, Flag, FlagField, PlanDraft } from "./types";
import { normalizePlan, planProblem } from "@/lib/domain/running";
import { EMPTY_RUN, readRun, type DraftRun } from "./running";

const FIELD_OF: Record<keyof DraftValues, FlagField> = {
  sets: "sets", repMin: "reps", repMax: "reps", restS: "rest", loadKg: "load", targetRir: "effort", targetRpe: "effort",
  tempo: "tempo", perSide: "reps", warmupSets: "warmup", dropSegments: "drop", dropScope: "drop", supersetGroup: "superset",
  optional: "row", notes: "notes",
};

/** Codes resolved by editing a field. Flags about other fields (and info-only flags) stay. */
function resolvesOnEdit(f: Flag, keys: (keyof DraftValues)[]): boolean {
  const fields = new Set(keys.map((k) => FIELD_OF[k]));
  if (!fields.has(f.field)) return false;
  if (f.code === "drop_count") return keys.includes("dropSegments");
  if (f.code === "drop_scope") return keys.includes("dropScope");
  return true;
}

/** The user edited values. Edited fields are marked as edited and their questions count as answered. */
export function editExercise(ex: DraftExercise, patch: Partial<DraftValues>): DraftExercise {
  const keys = Object.keys(patch) as (keyof DraftValues)[];
  const origin = { ...ex.origin };
  for (const k of keys) origin[k] = "edited";
  const next = { ...ex, ...patch, origin, flags: ex.flags.map((f) => (resolvesOnEdit(f, keys) ? { ...f, resolved: true } : f)) };
  if (patch.dropSegments === 0) { next.dropScope = null; next.flags = next.flags.map((f) => (f.field === "drop" ? { ...f, resolved: true } : f)); }
  return next;
}

export function applyOption(ex: DraftExercise, flagId: string, optionIndex: number): DraftExercise {
  const rf = ex.runFlags?.find((x) => x.id === flagId);
  if (rf) {
    const opt = rf.options?.[optionIndex];
    if (!opt || !ex.run) return ex;
    const next = editRun(ex, opt.runPatch ?? {});
    return { ...next, runFlags: next.runFlags!.map((x) => (x.id === flagId ? { ...x, resolved: true } : x)) };
  }
  const f = ex.flags.find((x) => x.id === flagId);
  const opt = f?.options?.[optionIndex];
  if (!f || !opt) return ex;
  const next = editExercise(ex, opt.patch);
  return { ...next, flags: next.flags.map((x) => (x.id === flagId ? { ...x, resolved: true } : x)) };
}

/** "Keep as written" for a non-blocking flag. */
export function acknowledge(ex: DraftExercise, flagId: string): DraftExercise {
  const ack = (x: Flag) => (x.id === flagId && !x.blocking ? { ...x, resolved: true } : x);
  return { ...ex, flags: ex.flags.map(ack), ...(ex.runFlags ? { runFlags: ex.runFlags.map(ack) } : {}) };
}

/** The user edited a planned run. Questions about its target count as answered once a target is set. */
export function editRun(ex: DraftExercise, patch: Partial<DraftRun>): DraftExercise {
  if (!ex.run) return ex;
  const run = normalizePlan({ ...ex.run, ...patch }) as DraftRun;
  const targetSet = "target_kind" in patch || "target_duration_s" in patch || "target_distance_m" in patch || "interval_count" in patch
    || "interval_work_s" in patch || "interval_work_m" in patch;
  const recoverySet = "interval_recovery_s" in patch;
  return {
    ...ex, run,
    runFlags: (ex.runFlags ?? []).map((f) => ((targetSet && f.field === "row") || (recoverySet && f.field === "rest") ? { ...f, resolved: true } : f)),
  };
}

/** "This is a run": read the row as a running prescription (its questions start fresh). */
export function treatAsRun(ex: DraftExercise): DraftExercise {
  const text = ex.original.map((o) => o.text);
  const r = readRun(ex.name, text.slice(1).join(" "), undefined, true);
  return { ...ex, run: r?.run ?? { ...EMPTY_RUN, name: ex.name || "Run" }, runFlags: r?.flags ?? [], runNotes: ex.runNotes ?? (r?.notes.join("\n") || null) };
}

/** "Not a run": use the row as an exercise again, with its original lifting reading. */
export function treatAsExercise(ex: DraftExercise): DraftExercise {
  return { ...ex, run: null };
}

export function chooseExercise(ex: DraftExercise, choice: ExerciseChoice): DraftExercise {
  return {
    ...ex,
    match: { ...ex.match, status: "confirmed", choice },
    flags: ex.flags.map((f) => (f.field === "exercise" ? { ...f, resolved: true } : f)),
  };
}

/** Resolve the same question the same way everywhere it's still open ("use the lower rest everywhere"). */
export function applyOptionEverywhere(draft: PlanDraft, code: Flag["code"], optionIndex: number): PlanDraft {
  return mapExercises(draft, (ex) => {
    let cur = ex;
    for (const f of ex.flags) if (f.code === code && !f.resolved && f.options?.[optionIndex]) cur = applyOption(cur, f.id, optionIndex);
    return cur;
  });
}

export function mapExercises(draft: PlanDraft, fn: (ex: DraftExercise) => DraftExercise): PlanDraft {
  return { ...draft, workouts: draft.workouts.map((w) => ({ ...w, exercises: w.exercises.map(fn) })) };
}

export interface Problem {
  workoutId: string;
  exerciseId?: string;
  message: string;
}

const int = (n: number | null, lo: number, hi: number) => n != null && Number.isInteger(n) && n >= lo && n <= hi;

/** Everything that must be fixed before the program can be created. Optional fields may stay empty. */
export function exerciseProblems(ex: DraftExercise): string[] {
  if (ex.skipped) return [];
  const p: string[] = [];
  if (ex.run) {
    if (!ex.run.name.trim()) p.push("Name the run.");
    for (const f of ex.runFlags ?? []) if (f.blocking && !f.resolved) p.push(f.message);
    const problem = planProblem(ex.run);
    if (problem) p.push(problem);
    return [...new Set(p)];
  }
  if (ex.match.status !== "confirmed" || !ex.match.choice) p.push("Choose the exercise.");
  if (!int(ex.sets, 1, 20)) p.push("Sets must be a whole number from 1 to 20.");
  if (!int(ex.repMin, 1, 100) || !int(ex.repMax, 1, 100) || ex.repMin! > ex.repMax!) p.push("Reps must be 1–100, minimum no higher than maximum.");
  if (ex.restS != null && !int(ex.restS, 0, 1800)) p.push("Rest must be 0–30 minutes.");
  if (ex.targetRir != null && !(ex.targetRir >= 0 && ex.targetRir <= 10)) p.push("RIR must be 0–10.");
  if (ex.targetRpe != null && !(ex.targetRpe >= 1 && ex.targetRpe <= 10)) p.push("RPE must be 1–10.");
  if (ex.loadKg != null && !(ex.loadKg >= 0 && ex.loadKg <= 1000)) p.push("Load must be 0–1000 kg.");
  if (!int(ex.warmupSets, 0, 10)) p.push("Warm-up sets must be 0–10.");
  if (!int(ex.dropSegments, 0, 5)) p.push("Drops must be 0–5.");
  if (ex.dropSegments > 0 && !ex.dropScope) p.push("Choose which sets the drop set applies to.");
  if (ex.tempo != null && ex.tempo.length > 20) p.push("Tempo is too long.");
  for (const f of ex.flags) if (f.blocking && !f.resolved && f.field !== "exercise") p.push(f.message);
  return [...new Set(p)];
}

export function draftProblems(draft: PlanDraft): Problem[] {
  const out: Problem[] = [];
  if (!draft.programName.trim()) out.push({ workoutId: "", message: "Give the program a name." });
  const live = draft.workouts.filter((w) => w.exercises.some((e) => !e.skipped));
  if (live.length === 0) out.push({ workoutId: "", message: "There's nothing to import yet." });
  for (const w of live) {
    if (!w.name.trim()) out.push({ workoutId: w.id, message: "Every workout needs a name." });
    for (const e of w.exercises) for (const m of exerciseProblems(e)) out.push({ workoutId: w.id, exerciseId: e.id, message: m });
  }
  return out;
}

export interface ProgramPayload {
  name: string;
  description: string | null;
  source_name: string | null;
  workouts: {
    name: string;
    warmup_notes: string | null;
    exercises: Record<string, unknown>[];
  }[];
}

/** What create_program_from_import() receives. A missing rest uses the user's default rest. */
export function toPayload(draft: PlanDraft, defaultRestS: number): ProgramPayload {
  return {
    name: draft.programName.trim(),
    description: draft.notes.length ? draft.notes.join("\n").slice(0, 2000) : null,
    source_name: draft.sourceName,
    workouts: draft.workouts
      .map((w) => ({ w, exercises: w.exercises.filter((e) => !e.skipped) }))
      .filter(({ exercises }) => exercises.length > 0)
      .map(({ w, exercises }) => ({
        name: w.name.trim(),
        warmup_notes: w.warmupNotes,
        exercises: exercises.map((e) => e.run ? {
          kind: "run", name: e.run.name.trim() || "Run", setting: e.run.setting, ...normalizePlan(e.run), optional: e.optional,
          notes: e.runNotes ?? null,
        } : ({
          ...(e.match.choice!.kind === "library" ? { exercise_id: e.match.choice!.id } : { catalog_slug: e.match.choice!.slug }),
          sets: e.sets, rep_min: e.repMin, rep_max: e.repMax, rest_s: e.restS ?? defaultRestS,
          target_rir: e.targetRir, target_rpe: e.targetRpe, tempo: e.tempo, target_weight_kg: e.loadKg,
          per_side: e.perSide, warmup_sets: e.warmupSets, drop_segments: e.dropSegments,
          drop_scope: e.dropSegments > 0 ? e.dropScope : null, superset_group: e.supersetGroup, optional: e.optional,
          notes: e.notes,
        })),
      })),
  };
}

export interface DraftSummary {
  workouts: number;
  exercises: number;
  skipped: number;
  newFromCatalog: string[];
  runs: number;
  defaultRest: number;
  notesKept: number;
}

export function summarise(draft: PlanDraft): DraftSummary {
  const ex = draft.workouts.flatMap((w) => w.exercises);
  const live = ex.filter((e) => !e.skipped);
  return {
    workouts: draft.workouts.filter((w) => w.exercises.some((e) => !e.skipped)).length,
    exercises: live.filter((e) => !e.run).length,
    runs: live.filter((e) => e.run).length,
    skipped: ex.length - live.length,
    newFromCatalog: [...new Set(live.filter((e) => !e.run && e.match.choice?.kind === "catalog").map((e) => e.match.choice!.name))],
    defaultRest: live.filter((e) => !e.run && e.restS == null).length,
    notesKept: live.filter((e) => (e.run ? e.runNotes : e.notes)).length,
  };
}
