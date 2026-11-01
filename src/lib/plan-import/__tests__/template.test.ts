import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog/catalog";
import { buildDraft, findHeaderRow, gridToRows, guessMapping } from "../extract";
import { detectTable } from "../grid";
import { draftProblems } from "../review";
import { PLAN_EXAMPLE, PLAN_TEMPLATE_HREF } from "../template";

let n = 0;
const ctx = { library: [], catalog: CATALOG, newId: () => `id${++n}` };
function read(text: string) {
  const table = detectTable(text);
  expect(table).not.toBeNull();
  const header = findHeaderRow(table!.grid);
  const g = gridToRows(table!.grid, header, guessMapping(table!.grid, header));
  return buildDraft({ importId: "imp", sourceKind: "csv", sourceName: "plan.csv", ...g }, ctx);
}

// The tutorial promises these read cleanly; if the importer changes, the promise must change with it.
describe("what the tutorial advertises", () => {
  it("the downloadable template imports as two workouts with every essential field", () => {
    const d = read(readFileSync(join(process.cwd(), "public", PLAN_TEMPLATE_HREF), "utf8"));
    expect(d.workouts.map((w) => [w.name, w.exercises.length])).toEqual([["Day 1 - Upper", 3], ["Day 2 - Lower", 2]]);
    expect(d.workouts[0].exercises[0]).toMatchObject({ sets: 3, repMin: 8, repMax: 12, restS: 90 });
    expect(d.workouts[0].exercises[1]).toMatchObject({ restS: 120 });
    for (const e of d.workouts.flatMap((w) => w.exercises)) expect(e.match.status).toBe("confirmed");
    expect(draftProblems(d)).toEqual([]);
  });

  it("the tutorial's one-row example reads as written, en dash included", () => {
    const text = [PLAN_EXAMPLE.header, ...PLAN_EXAMPLE.rows].map((r) => r.join("\t")).join("\n");
    const [e] = read(text).workouts.flatMap((w) => w.exercises);
    expect(e).toMatchObject({ name: "Cable row", sets: 3, repMin: 8, repMax: 12, restS: 90 });
  });
});
