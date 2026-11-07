import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog/catalog";
import type { LibraryEntry } from "@/lib/plan-import/match";
import {
  buildCopyDraft, canSave, missingFromPlan, planIsComplete, planLine, resolveExercise, rowProblems, toSavePayload, type PlanItem,
} from "../shared-copy";

const lib: LibraryEntry[] = [
  { id: "L1", name: "Barbell Bench Press", aliases: [], archived: false, catalogSlug: "barbell-bench-press" },
  { id: "L2", name: "My Hack Squat", aliases: [], archived: false, catalogSlug: null },
];
const plan: PlanItem[] = [
  { name: "Bench", catalog_slug: "barbell-bench-press", planned: true, sets: 3, rep_min: 6, rep_max: 8, rest_s: 180, warmup_sets: 2, target_weight_kg: 70, convention: "total" },
  { name: "Incline Dumbbell Press", catalog_slug: "incline-db-press", planned: true, sets: 3, rep_min: 8, rep_max: 10 },
  { name: "Mystery Machine Thing", planned: true, sets: 2, rep_min: 10, rep_max: 12, rest_s: 60, superset_group: "A", drop_segments: 1, drop_scope: "last_set" },
  { name: "Curl", planned: false },
];
const draft = () => buildCopyDraft({ requestId: "req", plan, workoutName: "Push", authorName: "Giulia Romano", library: lib, catalog: CATALOG });

describe("resolveExercise", () => {
  it("uses the recipient's own exercise linked to the same catalog entry", () => {
    expect(resolveExercise(plan[0], lib, CATALOG).resolution).toEqual({ kind: "library", id: "L1", name: "Barbell Bench Press" });
  });
  it("falls back to the catalog entry, never the author's record", () => {
    const r = resolveExercise(plan[1], lib, CATALOG).resolution;
    expect(r).toEqual({ kind: "catalog", slug: "incline-db-press", name: expect.any(String) });
  });
  it("leaves unknown exercises unresolved for the recipient to choose or create", () => {
    const r = resolveExercise(plan[2], lib, CATALOG);
    expect(r.resolution).toBeNull();
    expect(r.match.status).toBe("none");
  });
});

describe("buildCopyDraft", () => {
  it("copies only the prescription and never keeps a load by default", () => {
    const d = draft();
    expect(d.destination).toEqual({ kind: "new", name: "Push (from Giulia)" });
    expect(d.rows[0]).toMatchObject({ sets: 3, repMin: 6, repMax: 8, restS: 180, warmupSets: 2, prescribedLoadKg: 70, keepLoad: false });
    expect(d.rows[2]).toMatchObject({ supersetGroup: "A", dropSegments: 1, dropScope: "last_set" });
  });
  it("leaves gaps empty instead of guessing", () => {
    const d = draft();
    expect(d.rows[1].restS).toBeNull();
    expect(missingFromPlan(d.rows[1])).toEqual(["restS"]);
    expect(missingFromPlan(d.rows[3])).toEqual(["sets", "repMin", "repMax", "restS"]);
    expect(rowProblems(d.rows[1])).toContain("Add rest (0–30 min).");
    expect(planIsComplete(plan)).toBe(false);
    expect(canSave(d)).toBe(false);
  });
});

describe("toSavePayload", () => {
  it("sends references only to the recipient's library, the catalog or a new exercise", () => {
    const d = draft();
    d.rows[1].restS = 90;
    d.rows[2].resolution = { kind: "new", name: "Mystery Machine Thing" };
    d.rows[3].include = false;
    expect(canSave(d)).toBe(true);
    const p = toSavePayload(d);
    expect(p.exercises).toHaveLength(3);
    expect(p.exercises[0]).toMatchObject({ exercise_id: "L1", target_weight_kg: null });
    expect(p.exercises[1]).toMatchObject({ catalog_slug: "incline-db-press", rest_s: 90 });
    expect(p.exercises[2]).toMatchObject({ new: { name: "Mystery Machine Thing" }, superset_group: "A", drop_scope: "last_set" });
    expect(JSON.stringify(p)).not.toMatch(/"reps"|"kg"|completed|rir_result/);
  });
  it("keeps the prescribed load only when chosen", () => {
    const d = draft();
    d.rows[0].keepLoad = true;
    d.rows = d.rows.slice(0, 1);
    expect(toSavePayload(d).exercises[0].target_weight_kg).toBe(70);
  });
});

describe("planLine", () => {
  it("marks what the plan doesn't say", () => {
    expect(planLine(plan[0])).toBe("3 × 6–8 · rest 3 min");
    expect(planLine(plan[1])).toBe("3 × 8–10");
    expect(planLine(plan[3])).toBe("Added during the workout · no plan");
  });
});
