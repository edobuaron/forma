import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import { CATALOG } from "../catalog";
import { conventionProblem, e1rmAllowed } from "../conventions";
import { nameKey } from "../names";
import { catalogSql, SQL_BEGIN, SQL_END } from "../sql";

const MIGRATION = path.resolve(__dirname, "../../../../supabase/migrations/20261027000009_onboarding_and_catalog.sql");

// The 22 exercises the original seed created. Their slugs link existing accounts to the catalog.
const ORIGINAL_SEED = [
  "incline-smith-press", "seated-shoulder-press", "cable-lateral-raise", "pec-deck", "overhead-cable-triceps-extension",
  "weighted-pull-up", "barbell-row", "lat-pulldown", "cable-rear-delt-fly", "preacher-curl", "bayesian-cable-curl",
  "leg-press", "seated-leg-curl", "leg-extension", "lumbar-extension", "standing-calf-raise", "cable-crunch",
  "explosive-high-pull-up", "assisted-muscle-up-transition", "straight-bar-dip", "incline-db-press", "seated-cable-row",
];

describe("exercise catalog", () => {
  it("has a library-sized list", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(100);
    expect(CATALOG.length).toBeLessThanOrEqual(150);
  });

  it("has unique slugs, and no two entries share a name or alias key", () => {
    expect(new Set(CATALOG.map((e) => e.slug)).size).toBe(CATALOG.length);
    const owner = new Map<string, string>();
    for (const e of CATALOG) {
      for (const n of [e.name, ...e.aliases]) {
        const k = nameKey(n);
        const prev = owner.get(k);
        if (prev && prev !== e.slug) throw new Error(`"${n}" (${e.slug}) collides with ${prev}`);
        owner.set(k, e.slug);
      }
    }
  });

  it("includes every originally seeded exercise under the same slug", () => {
    const slugs = new Set(CATALOG.map((e) => e.slug));
    for (const s of ORIGINAL_SEED) expect(slugs.has(s), s).toBe(true);
  });

  it("uses only known muscles", () => {
    for (const e of CATALOG) for (const m of [...e.primary, ...e.secondary]) expect(MUSCLE_LABELS[m], `${e.slug}: ${m}`).toBeDefined();
    for (const e of CATALOG) expect(e.primary.length, e.slug).toBeGreaterThan(0);
  });

  it("keeps load type, weight entry and progression consistent", () => {
    for (const e of CATALOG) {
      expect(conventionProblem({ equipment: e.equipment, loadType: e.loadType, weightEntry: e.weightEntry }), e.slug).toBeNull();
      if (e.e1rm) expect(e1rmAllowed(e), e.slug).toBe(true);
      if (e.category === "skill") expect(e.progression, e.slug).toBe("skill");
      if (e.loadType === "assisted") expect(e.weightEntry, e.slug).toBe("assistance");
      expect(e.repMin, e.slug).toBeLessThanOrEqual(e.repMax);
      expect(e.incrementKg, e.slug).toBeGreaterThan(0);
    }
  });

  it("keeps notes neutral: no performance estimates or personal priorities", () => {
    for (const e of CATALOG) {
      const t = `${e.notes} ${e.instructions ?? ""}`.toLowerCase();
      expect(t, e.slug).not.toMatch(/baseline|estimate|priority|maintenance|untested|\+\d+\s?kg|confirm before/);
      expect(e.notes.length, e.slug).toBeGreaterThan(0);
    }
  });

  it("matches the SQL in migration 009", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const start = sql.indexOf(SQL_BEGIN.split(" (")[0]);
    const end = sql.indexOf(SQL_END);
    expect(start).toBeGreaterThan(-1);
    const embedded = sql.slice(start, end + SQL_END.length);
    if (process.env.UPDATE_CATALOG_SQL && embedded !== catalogSql()) {
      writeFileSync(MIGRATION, sql.slice(0, start) + catalogSql() + sql.slice(end + SQL_END.length));
      return;
    }
    expect(embedded).toBe(catalogSql());
  });
});
