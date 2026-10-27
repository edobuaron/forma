import { describe, expect, it } from "vitest";
import { CATALOG } from "../catalog";
import { classifyDuplicates, MAX_IMPORT_ROWS, parseCsv, previewImport, renameRow, TEMPLATE_CSV } from "../import";
import { cleanText, nameKey } from "../names";

const HEADER = "name,equipment,load_type,weight_entry,primary_muscles,secondary_muscles,category,sets,rep_min,rep_max,rest_seconds,increment_kg,e1rm,instructions,notes";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas, newlines, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"multi\nline",z');
    expect(rows).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["multi\nline", "z"]]);
  });
});

describe("nameKey", () => {
  it("treats punctuation, case, spacing and simple plurals as the same name", () => {
    expect(nameKey("Pull-Ups")).toBe(nameKey("pull up"));
    expect(nameKey("Pullup")).toBe(nameKey("PULL-UP"));
    expect(nameKey("Dips")).toBe(nameKey("dip"));
    expect(nameKey("Leg Press")).toBe("legpress"); // "press" keeps its double s
    expect(nameKey("Lat Pulldown")).not.toBe(nameKey("Lat Pullover"));
  });
});

describe("cleanText", () => {
  it("removes control characters and collapses whitespace", () => {
    expect(cleanText("  Bench\u0000\u0007  Press\t ")).toBe("Bench Press");
    expect(cleanText("line one\r\nline\u0000 two", { multiline: true })).toBe("line one\nline two");
  });
});

describe("previewImport", () => {
  it("accepts the downloadable template", () => {
    const p = previewImport(TEMPLATE_CSV, [], CATALOG);
    expect(p.fileErrors).toEqual([]);
    expect(p.rows.map((r) => [r.status, r.errors])).toEqual(p.rows.map(() => ["valid", []]));
    const ring = p.rows.find((r) => r.draft?.name === "Ring Dip")!.draft!;
    expect(ring).toMatchObject({ load_type: "bodyweight", weight_convention: "added", progression: "bodyweight_reps", e1rm_eligible: false });
    const band = p.rows.find((r) => r.draft?.name.startsWith("Assisted"))!.draft!;
    expect(band).toMatchObject({ load_type: "assisted", weight_convention: "assistance" });
  });

  it("fills conservative defaults and labels the increment as generic", () => {
    const p = previewImport("name,equipment\nCable Y Raise,cable\nDB Thing,dumbbell", []);
    expect(p.rows[0].draft).toMatchObject({ load_type: "external", weight_convention: "stack", category: "isolation", progression: "double_progression", e1rm_eligible: false, increment_is_generic: true, default_sets: 3, default_rep_min: 8, default_rep_max: 12 });
    expect(p.rows[1].draft).toMatchObject({ weight_convention: "per_dumbbell", increment_kg: 2 });
  });

  it("keeps a user-given increment as confirmed", () => {
    const p = previewImport("name,equipment,increment_kg\nCable Y Raise,cable,1.25", []);
    expect(p.rows[0].draft).toMatchObject({ increment_kg: 1.25, increment_is_generic: false });
  });

  it("reports row-specific errors", () => {
    const csv = [
      HEADER,
      ",cable,,,,,,,,,,,,,",                                       // no name
      "Bad Kit,spaceship,,,,,,,,,,,,,",                            // unknown equipment
      "Range,cable,,,,,,,12,8,,,,,",                               // rep min > max
      "Assist Wrong,bodyweight,assisted,added,lats,,,,,,,,,,",     // assisted must record assistance
      "Dumbbell On Cable,cable,external,per_dumbbell,,,,,,,,,,,",  // per dumbbell needs dumbbells
      "Curl 1RM,dumbbell,external,,biceps,,isolation,,,,,,yes,,",  // e1RM only for compound external
      "Weird Muscle,cable,,,earlobes,,,,,,,,,,",
      "=HYPERLINK(1),cable,,,,,,,,,,,,,",
      "Sets,cable,,,,,,0,,,,,,,",
    ].join("\n");
    const rows = previewImport(csv, []).rows;
    expect(rows.every((r) => r.status === "error")).toBe(true);
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rows[0].errors[0]).toMatch(/Name is required/);
    expect(rows[1].errors[0]).toMatch(/Unknown equipment/);
    expect(rows[2].errors[0]).toMatch(/Rep min/);
    expect(rows[3].errors[0]).toMatch(/assistance/);
    expect(rows[4].errors[0]).toMatch(/per dumbbell/);
    expect(rows[5].errors[0]).toMatch(/1RM/);
    expect(rows[6].errors[0]).toMatch(/Unknown muscle/);
    expect(rows[7].errors[0]).toMatch(/can't start/);
    expect(rows[8].errors[0]).toMatch(/Sets/);
  });

  it("refuses files without a name column, empty files and oversized files", () => {
    expect(previewImport("exercise,equipment\nA,cable", []).fileErrors[0]).toMatch(/name/);
    expect(previewImport("", []).fileErrors[0]).toMatch(/empty/);
    expect(previewImport("name\n", []).fileErrors[0]).toMatch(/no exercises/);
    const many = "name\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Ex ${i}`).join("\n");
    expect(previewImport(many, []).fileErrors[0]).toMatch(/at most/);
  });

  it("ignores unknown columns and tells the user", () => {
    const p = previewImport("name,video_url\nCable Y Raise,http://x", []);
    expect(p.ignoredColumns).toEqual(["video_url"]);
    expect(p.rows[0].status).toBe("valid");
  });

  it("marks duplicates against the library (archived too) and within the file", () => {
    const csv = "name\nLat Pulldowns\nmy new curl\nMy New Curl\nOld Thing";
    const p = previewImport(csv, [{ name: "Lat Pulldown", archived: false }, { name: "old thing", archived: true }]);
    expect(p.rows.map((r) => r.status)).toEqual(["duplicate", "valid", "duplicate", "duplicate"]);
    expect(p.rows[0].duplicateOf).toEqual({ kind: "library", name: "Lat Pulldown", archived: false });
    expect(p.rows[2].duplicateOf).toEqual({ kind: "file", name: "my new curl" });
    expect(p.rows[3].duplicateOf?.archived).toBe(true);
  });

  it("is safe to repeat: a second import of the same file finds only duplicates", () => {
    const first = previewImport(TEMPLATE_CSV, []);
    const library = first.rows.map((r) => ({ name: r.draft!.name, archived: false }));
    expect(previewImport(TEMPLATE_CSV, library).rows.every((r) => r.status === "duplicate")).toBe(true);
  });

  it("warns when a row matches a catalog exercise", () => {
    const p = previewImport("name,equipment\nBench Press,barbell", [], CATALOG);
    expect(p.rows[0].status).toBe("valid");
    expect(p.rows[0].warnings.join(" ")).toMatch(/catalog exercise "Barbell Bench Press"/);
  });

  it("lets the user resolve a duplicate by renaming it", () => {
    const lib = [{ name: "Cable Curl", archived: false }];
    const p = previewImport("name,equipment\nCable Curl,cable", lib);
    expect(p.rows[0].status).toBe("duplicate");
    const fixed = renameRow(p.rows, 2, "Cable Curl (low pulley)", lib);
    expect(fixed[0].status).toBe("valid");
    expect(fixed[0].draft?.name).toBe("Cable Curl (low pulley)");
    expect(classifyDuplicates(fixed, [...lib, { name: "Cable Curl (low pulley)", archived: false }])[0].status).toBe("duplicate");
  });

  it("cleans untrusted text without interpreting it", () => {
    const p = previewImport('name,equipment,notes\n"<script>alert(1)</script> Row",cable,"a\u0000b"', []);
    expect(p.rows[0].draft?.name).toBe("<script>alert(1)</script> Row"); // stored as text; React renders it escaped
    expect(p.rows[0].draft?.notes).toBe("ab");
  });
});
