import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog/catalog";
import { buildDraft, findHeaderRow, gridToRows, guessMapping, textToRows } from "../extract";
import { detectTable, readXlsx } from "../grid";
import { expandName, matchExercise, type LibraryEntry } from "../match";
import { applyOption, applyOptionEverywhere, chooseExercise, draftProblems, editExercise, summarise, toPayload } from "../review";
import type { PlanDraft } from "../types";

const library: LibraryEntry[] = [
  { id: "lib-bench", name: "Barbell Bench Press", aliases: ["Bench press"], archived: false, catalogSlug: null },
  { id: "lib-row", name: "Seated Cable Row", aliases: [], archived: false, catalogSlug: null },
  { id: "lib-old", name: "Leg Curl", aliases: [], archived: true, catalogSlug: null },
];
let n = 0;
const ctx = { library, catalog: CATALOG, newId: () => `id${++n}` };

function fromText(text: string, name = "plan.txt"): PlanDraft {
  const table = detectTable(text);
  if (table) {
    const header = findHeaderRow(table.grid);
    const g = gridToRows(table.grid, header, guessMapping(table.grid, header));
    return buildDraft({ importId: "imp", sourceKind: "paste", sourceName: name, ...g }, ctx);
  }
  return buildDraft({ importId: "imp", sourceKind: "paste", sourceName: name, ...textToRows(text) }, ctx);
}
const ex = (d: PlanDraft) => d.workouts.flatMap((w) => w.exercises);

describe("table layouts", () => {
  it("reads a spreadsheet paste with a day column, units in headers and RPE", () => {
    const d = fromText([
      "Day\tExercise\tSets\tReps\tRest (min)\tRPE\tNotes",
      "Upper A\tBench press\t4\t6-8\t3\t8\tPause on chest",
      "\tSeated cable row\t3\t10-12\t2\t7,5\t",
      "Lower A\tBack squat\t4\t5\t3\t8\t",
    ].join("\n"));
    expect(d.workouts.map((w) => [w.name, w.exercises.length])).toEqual([["Upper A", 2], ["Lower A", 1]]);
    const [bench, row] = ex(d);
    expect(bench).toMatchObject({ sets: 4, repMin: 6, repMax: 8, restS: 180, targetRpe: 8, targetRir: null, notes: "Pause on chest" });
    expect(bench.match).toMatchObject({ status: "confirmed", choice: { kind: "library", id: "lib-bench" } });
    expect(row).toMatchObject({ restS: 120, targetRpe: 7.5 });
    expect(bench.original).toContainEqual({ label: "Reps", text: "6-8" });
    expect(bench.source.label).toBe("B2");
  });

  it("reads a semicolon CSV with decimal commas and heading rows between days (Italian headers)", () => {
    const d = fromText([
      "Esercizio;Serie;Ripetizioni;Recupero;Carico (kg)",
      "Giorno 1 - Push;;;;",
      "Panca piana;4;8;2';62,5",
      "Alzate laterali;3;12-15;60\";8",
      ";;;;",
      "Giorno 2 - Pull;;;;",
      "Rematore bilanciere;4;8;90s;50",
    ].join("\n"));
    expect(d.workouts.map((w) => w.name)).toEqual(["Giorno 1 - Push", "Giorno 2 - Pull"]);
    const [panca, alzate] = ex(d);
    expect(panca).toMatchObject({ sets: 4, repMin: 8, restS: 120, loadKg: 62.5 });
    expect(alzate).toMatchObject({ repMin: 12, repMax: 15, restS: 60, loadKg: 8 });
    expect(panca.match.choice?.name).toBe("Barbell Bench Press"); // via "panca piana" → bench press
    expect(panca.match.status).not.toBe("none");
  });

  it("guesses columns without a header row", () => {
    const d = fromText("Bench press\t3x8\t90s\nSeated cable row\t3x10-12\t2 min");
    expect(ex(d).map((e) => [e.name, e.sets, e.repMin, e.repMax, e.restS])).toEqual([
      ["Bench press", 3, 8, 8, 90], ["Seated cable row", 3, 10, 12, 120],
    ]);
  });

  it("reads a Markdown table", () => {
    const d = fromText("| Exercise | Sets x Reps | Rest |\n|---|---|---|\n| Bench press | 3x8 | 2 min |");
    expect(ex(d)[0]).toMatchObject({ name: "Bench press", sets: 3, repMin: 8, restS: 120 });
  });

  it("surfaces ambiguous columns instead of choosing a meaning", () => {
    const d = fromText("Exercise\tSets\tReps\tRest\tIntensity\nBench press\t3\t8\t2\t8");
    const e = ex(d)[0];
    expect(e.restS).toBeNull();
    expect(e.targetRir).toBeNull();
    expect(e.targetRpe).toBeNull();
    expect(e.flags.filter((f) => f.blocking).map((f) => f.code)).toEqual(["rest_unit", "effort_unclear"]);
  });

  it("notes several week columns and imports only the mapped one", () => {
    const table = detectTable("Exercise\tWeek 1\tWeek 2\tWeek 3\nBench press\t3x8\t3x9\t3x10")!;
    const header = findHeaderRow(table.grid);
    expect(header).toBeNull(); // weeks aren't known columns; the content decides
    const mapping = guessMapping(table.grid, 0);
    const g = gridToRows(table.grid, 0, ["exercise", "setsReps", null, null]);
    expect(g.notices[0]).toMatch(/3 week columns/);
    expect(mapping.length).toBe(4);
  });

  it("keeps missing values missing and blocks import until they're given", () => {
    const d = fromText("Exercise\tSets\tReps\nBench press\t\t8\nMystery move\t3\t10");
    const [bench, mystery] = ex(d);
    expect(bench.sets).toBeNull();
    expect(mystery.match.status).toBe("none");
    const problems = draftProblems(d).map((p) => p.message);
    expect(problems).toEqual(expect.arrayContaining(["Choose the exercise.", "Sets must be a whole number from 1 to 20."]));
  });

  it("assigns supersets only when a letter is shared", () => {
    const d = fromText("Order\tExercise\tSets x reps\nA1\tBench press\t3x8\nA2\tSeated cable row\t3x10\nB1\tBack squat\t3x5");
    expect(ex(d).map((e) => e.supersetGroup)).toEqual(["A", "A", null]);
  });
});

describe("free text", () => {
  it("reads headings, bullets, notation in either order, and note lines", () => {
    const d = fromText([
      "Coach Plan – Block 1",
      "",
      "Day 1: Upper",
      "- Bench press 3x8-10 rest 2 min RIR 2",
      "Note: pause on the chest",
      "- 3x12 Seated cable row",
      "- Lateral raise: 3x15 + drop set on the last set",
      "Warm-up: 5 min bike",
      "Day 2: Lower",
      "1. Back squat 4 x 5 @ RPE 8",
      "2. Bulgarian split squat 3x10 each leg",
    ].join("\n"));
    expect(d.workouts.map((w) => w.name)).toEqual(["Day 1: Upper", "Day 2: Lower"]);
    const [bench, row, raise, squat, bss] = ex(d);
    expect(bench).toMatchObject({ name: "Bench press", sets: 3, repMin: 8, repMax: 10, restS: 120, targetRir: 2, notes: "pause on the chest" });
    expect(row).toMatchObject({ name: "Seated cable row", sets: 3, repMin: 12 });
    expect(raise).toMatchObject({ sets: 3, repMin: 15, dropScope: "last_set" });
    expect(raise.flags.map((f) => f.code)).toContain("drop_count");
    expect(squat).toMatchObject({ sets: 4, repMin: 5, targetRpe: 8, targetRir: null });
    expect(bss).toMatchObject({ sets: 3, repMin: 10, perSide: true });
    expect(d.workouts[0].warmupNotes).toBe("Warm-up: 5 min bike");
    expect(d.programName).toBe("Coach Plan – Block 1");
  });
});

// ---------- XLSX ----------
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const raw = enc.encode(content);
    const data = deflateRawSync(raw);
    const local = new Uint8Array(30 + nameB.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(8, 8, true);
    dv.setUint32(18, data.length, true); dv.setUint32(22, raw.length, true); dv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true); cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true);
    cen.set(nameB, 46);
    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

const sheetXml = (cells: string) => `<?xml version="1.0"?><worksheet><sheetData>${cells}</sheetData><mergeCells><mergeCell ref="A2:A3"/></mergeCells></worksheet>`;

describe("xlsx", () => {
  it("reads shared strings, numbers, merged day cells and skips hidden sheets", async () => {
    const bytes = zip({
      "xl/workbook.xml": `<workbook><sheets><sheet name="Week A" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Day</t></si><si><t>Exercise</t></si><si><t>Sets</t></si><si><t>Reps</t></si><si><t>Load (kg)</t></si><si><t>Push &amp; Pull</t></si><si><r><t>Bench </t></r><r><t>press</t></r></si><si><t>8-10</t></si><si><t>Seated cable row</t></si></sst>`,
      "xl/worksheets/sheet1.xml": sheetXml(
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>`
        + `<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2"><v>3</v></c><c r="D2" t="s"><v>7</v></c><c r="E2"><v>62.500000000001</v></c></row>`
        + `<row r="3"><c r="B3" t="s"><v>8</v></c><c r="C3"><f>2+1</f><v>3</v></c><c r="D3" t="inlineStr"><is><t>12</t></is></c></row>`),
      "xl/worksheets/sheet2.xml": sheetXml(`<row r="1"><c r="A1" t="inlineStr"><is><t>hidden</t></is></c></row>`),
    });
    const sheets = await readXlsx(bytes);
    expect(sheets.map((s) => s.name)).toEqual(["Week A"]);
    const grid = sheets[0].rows;
    expect(grid[1]).toEqual(["Push & Pull", "Bench press", "3", "8-10", "62.5"]);
    expect(grid[2][0]).toBe("Push & Pull"); // merged A2:A3
    const header = findHeaderRow(grid);
    const g = gridToRows(grid, header, guessMapping(grid, header), sheets[0].name);
    const d = buildDraft({ importId: "x", sourceKind: "xlsx", sourceName: "plan.xlsx", ...g }, ctx);
    expect(d.workouts.map((w) => w.name)).toEqual(["Push & Pull"]);
    expect(ex(d).map((e) => [e.name, e.sets, e.repMin, e.repMax, e.loadKg])).toEqual([["Bench press", 3, 8, 10, 62.5], ["Seated cable row", 3, 12, 12, null]]);
    expect(ex(d)[0].source.label).toBe("Week A!B2");
  });

  it("rejects something that isn't a zip", async () => {
    await expect(readXlsx(new TextEncoder().encode("name,sets\nBench,3"))).rejects.toThrow(/valid .xlsx/);
  });
});

describe("matching", () => {
  it("uses exact names, proposes abbreviations and never picks a merely similar exercise", () => {
    expect(matchExercise("bench press", library, CATALOG)).toMatchObject({ status: "confirmed", choice: { id: "lib-bench" } });
    expect(expandName("DB RDL")).toBe("dumbbell romanian deadlift");
    const db = matchExercise("DB bench press", library, CATALOG);
    expect(db.choice?.name ?? "").not.toBe("Barbell Bench Press");
    expect(db.status).not.toBe("confirmed");
    const vague = matchExercise("Cable row variation", library, CATALOG);
    expect(vague.status).toBe("none");
    expect(vague.candidates.map((c) => c.choice.name)).toContain("Seated Cable Row");
  });

  it("proposes the same words in another order, after expanding abbreviations", () => {
    const m = matchExercise("DB incline press", library, CATALOG);
    expect(m).toMatchObject({ status: "proposed", choice: { name: "Incline Dumbbell Press" } });
  });

  it("doesn't auto-pick an archived exercise", () => {
    expect(matchExercise("Leg curl", library, []).status).toBe("proposed");
  });

  it("offers catalog exercises the library doesn't have", () => {
    const m = matchExercise("Lateral raise", library, CATALOG);
    expect(m.choice?.kind).toBe("catalog");
  });
});

describe("review", () => {
  it("resolves questions by option, by editing, or everywhere at once, and builds the payload", () => {
    const d = fromText("Exercise\tSets\tReps\tRest\nBench press\t3\t12/10/8\t60-90s\nSeated cable row\t3\t10\t60-90s");
    expect(draftProblems(d).length).toBeGreaterThan(0);
    let d2 = applyOptionEverywhere(d, "rest_range", 1);
    const [bench, row] = ex(d2);
    expect([bench.restS, row.restS]).toEqual([90, 90]);
    const fixed = applyOption(bench, bench.flags.find((f) => f.code === "ambiguous_reps")!.id, 0);
    expect(fixed).toMatchObject({ repMin: 8, repMax: 12 });
    d2 = { ...d2, workouts: [{ ...d2.workouts[0], exercises: [fixed, row] }] };
    expect(draftProblems(d2)).toEqual([]);
    const payload = toPayload(d2, 120);
    expect(payload.workouts[0].exercises[0]).toMatchObject({ exercise_id: "lib-bench", sets: 3, rep_min: 8, rep_max: 12, rest_s: 90, target_rpe: null, drop_scope: null });
    expect(summarise(d2)).toMatchObject({ workouts: 1, exercises: 2, skipped: 0 });
  });

  it("uses the default rest only where the plan gave none, and skipped rows aren't sent", () => {
    const d = fromText("Exercise\tSets\tReps\nBench press\t3\t8\nMystery move\t3\t8");
    const [bench, mystery] = ex(d);
    const d2 = { ...d, workouts: [{ ...d.workouts[0], exercises: [bench, { ...mystery, skipped: true }] }] };
    expect(draftProblems(d2)).toEqual([]);
    const p = toPayload(d2, 75);
    expect(p.workouts[0].exercises).toHaveLength(1);
    expect(p.workouts[0].exercises[0].rest_s).toBe(75);
    expect(summarise(d2)).toMatchObject({ exercises: 1, skipped: 1, defaultRest: 1 });
  });

  it("requires a confirmed match and a drop scope", () => {
    const d = fromText("Exercise\tSets x reps\nDB bench press\t3x10 + 2 drops");
    let e = ex(d)[0];
    expect(draftProblems(d).map((p) => p.message)).toEqual(expect.arrayContaining(["Choose the exercise.", "Choose which sets the drop set applies to."]));
    e = chooseExercise(e, { kind: "library", id: "lib-bench", name: "Barbell Bench Press" });
    e = editExercise(e, { dropScope: "all_sets" });
    const d2 = { ...d, workouts: [{ ...d.workouts[0], exercises: [e] }] };
    expect(draftProblems(d2)).toEqual([]);
    expect(toPayload(d2, 90).workouts[0].exercises[0]).toMatchObject({ drop_segments: 2, drop_scope: "all_sets" });
  });
});
