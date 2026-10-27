// CSV exercise import: parse, validate and classify rows for the preview. Pure; no I/O.
// The format is documented in docs/EXERCISE_IMPORT.md and public/exercise-import-template.csv.
// Imported text is untrusted: it is cleaned, length-limited and only ever rendered as text.
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import {
  GENERIC_INCREMENT_KG, type CatalogCategory, type CatalogEquipment, type CatalogExercise, type CatalogLoadType,
  type CatalogProgression, type WeightEntry,
} from "./catalog";
import { conventionProblem, defaultCategory, defaultProgression, defaultWeightEntry, e1rmAllowed } from "./conventions";
import { cleanText, nameKey } from "./names";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 256 * 1024;

export const IMPORT_COLUMNS = [
  "name", "aliases", "equipment", "load_type", "weight_entry", "primary_muscles", "secondary_muscles", "category",
  "sets", "rep_min", "rep_max", "rest_seconds", "increment_kg", "e1rm", "instructions", "notes",
] as const;
type Column = (typeof IMPORT_COLUMNS)[number];

/** What import_exercises() receives for one row. */
export interface ExerciseDraft {
  name: string;
  aliases: string[];
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: CatalogEquipment;
  category: CatalogCategory;
  load_type: CatalogLoadType;
  weight_convention: WeightEntry;
  progression: CatalogProgression;
  e1rm_eligible: boolean;
  default_sets: number;
  default_rep_min: number;
  default_rep_max: number;
  default_rest_s: number;
  increment_kg: number;
  increment_is_generic: boolean;
  instructions: string | null;
  notes: string | null;
}

export type RowStatus = "valid" | "duplicate" | "error";
export interface ImportRow {
  /** 1-based line number in the file (header = line 1). */
  line: number;
  raw: Record<string, string>;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  draft: ExerciseDraft | null;
  /** Why the row is a duplicate: an existing exercise or an earlier row in the file. */
  duplicateOf?: { kind: "library" | "file"; name: string; archived?: boolean };
}

export interface ImportPreview {
  fileErrors: string[];
  ignoredColumns: string[];
  rows: ImportRow[];
}

// ---------- CSV parsing (RFC 4180: quotes, doubled quotes, CRLF, BOM) ----------
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- value parsing ----------
const EQUIPMENT: Record<string, CatalogEquipment> = {
  barbell: "barbell", "ez bar": "barbell", ezbar: "barbell", "trap bar": "barbell",
  dumbbell: "dumbbell", dumbbells: "dumbbell", db: "dumbbell",
  cable: "cable", cables: "cable",
  machine: "machine", smith: "smith", "smith machine": "smith",
  bodyweight: "bodyweight", "body weight": "bodyweight", none: "bodyweight",
  other: "other", kettlebell: "other", band: "other",
};
const LOAD_TYPES: Record<string, CatalogLoadType> = {
  external: "external", weights: "external", weight: "external",
  bodyweight: "bodyweight", "body weight": "bodyweight",
  weighted: "weighted_bodyweight", weighted_bodyweight: "weighted_bodyweight", "weighted bodyweight": "weighted_bodyweight",
  assisted: "assisted",
};
const ENTRIES: Record<string, WeightEntry> = {
  total: "total", "total weight": "total",
  per_dumbbell: "per_dumbbell", "per dumbbell": "per_dumbbell",
  per_side: "per_side", "per side": "per_side",
  stack: "stack", pin: "stack",
  added: "added", "added weight": "added",
  assistance: "assistance", assist: "assistance",
};
const CATEGORIES: Record<string, CatalogCategory> = {
  compound: "compound", isolation: "isolation", bodyweight: "bodyweight",
  weighted_bodyweight: "weighted_bodyweight", "weighted bodyweight": "weighted_bodyweight", skill: "skill",
};
const MUSCLES: Record<string, string> = Object.fromEntries(
  Object.entries(MUSCLE_LABELS).flatMap(([k, label]) => [[k, k], [label.toLowerCase(), k], [k.replace(/_/g, " "), k]]),
);

const norm = (v: string) => v.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
function pick<T>(map: Record<string, T>, v: string): T | undefined {
  return map[v.trim().toLowerCase()] ?? map[norm(v)] ?? map[norm(v).replace(/ /g, "_")];
}
const list = (v: string) => v.split(/[;|]/).map((x) => cleanText(x)).filter(Boolean);

function int(v: string, label: string, min: number, max: number, errors: string[]): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number from ${min} to ${max}.`); return undefined; }
  return n;
}

// ---------- validation ----------
export interface ExistingExercise { name: string; archived: boolean }

/** Validate and classify every row. `existing` is the user's library (archived included). */
export function previewImport(text: string, existing: ExistingExercise[], catalog: readonly CatalogExercise[] = []): ImportPreview {
  const fileErrors: string[] = [];
  if (text.length > MAX_IMPORT_BYTES) return { fileErrors: [`The file is larger than ${MAX_IMPORT_BYTES / 1024} KB.`], ignoredColumns: [], rows: [] };
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length === 0) return { fileErrors: ["The file is empty."], ignoredColumns: [], rows: [] };

  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const known = new Set<string>(IMPORT_COLUMNS);
  const ignoredColumns = header.filter((h) => h && !known.has(h));
  if (!header.includes("name")) fileErrors.push('The first row must be a header with at least a "name" column.');
  const body = table.slice(1);
  if (body.length === 0 && !fileErrors.length) fileErrors.push("The file has a header but no exercises.");
  if (body.length > MAX_IMPORT_ROWS) fileErrors.push(`Import at most ${MAX_IMPORT_ROWS} exercises at a time (this file has ${body.length}).`);
  if (fileErrors.length) return { fileErrors, ignoredColumns, rows: [] };

  const rows = body.map((cells, i) => {
    const raw: Record<string, string> = {};
    header.forEach((h, j) => { if (known.has(h)) raw[h] = cells[j] ?? ""; });
    return validateRow(raw, i + 2);
  });
  return { fileErrors, ignoredColumns, rows: classifyDuplicates(rows, existing, catalog) };
}

export function validateRow(raw: Partial<Record<Column, string>>, line: number): ImportRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const get = (c: Column) => raw[c] ?? "";

  const name = cleanText(get("name"));
  if (!name) errors.push("Name is required.");
  else if (name.length > 120) errors.push("Name must be at most 120 characters.");
  else if (/^[=+\-@]/.test(name)) errors.push("Name can't start with =, +, - or @.");
  else if (!nameKey(name)) errors.push("Name needs at least one letter or number.");

  const equipment = get("equipment").trim() ? pick(EQUIPMENT, get("equipment")) : "other";
  if (!equipment) errors.push(`Unknown equipment "${cleanText(get("equipment")).slice(0, 40)}". Use barbell, dumbbell, cable, machine, smith, bodyweight or other.`);

  let loadType = get("load_type").trim() ? pick(LOAD_TYPES, get("load_type")) : undefined;
  if (get("load_type").trim() && !loadType) errors.push(`Unknown load type "${cleanText(get("load_type")).slice(0, 40)}". Use external, bodyweight, weighted or assisted.`);
  if (!get("load_type").trim()) loadType = equipment === "bodyweight" ? "bodyweight" : "external";

  let weightEntry = get("weight_entry").trim() ? pick(ENTRIES, get("weight_entry")) : undefined;
  if (get("weight_entry").trim() && !weightEntry) errors.push(`Unknown weight entry "${cleanText(get("weight_entry")).slice(0, 40)}". Use total, per dumbbell, per side, stack, added or assistance.`);
  if (!get("weight_entry").trim() && equipment && loadType) weightEntry = defaultWeightEntry(equipment, loadType);

  const category = get("category").trim() ? pick(CATEGORIES, get("category")) : loadType ? defaultCategory(loadType) : undefined;
  if (get("category").trim() && !category) errors.push(`Unknown category "${cleanText(get("category")).slice(0, 40)}". Use compound, isolation, bodyweight, weighted bodyweight or skill.`);

  const muscles = (col: Column) => {
    const out: string[] = [];
    for (const m of list(get(col))) {
      const k = pick(MUSCLES, m);
      if (k) { if (!out.includes(k)) out.push(k); } else errors.push(`Unknown muscle "${m.slice(0, 40)}" in ${col}.`);
    }
    return out;
  };
  const primary = muscles("primary_muscles");
  const secondary = muscles("secondary_muscles").filter((m) => !primary.includes(m));
  if (primary.length === 0 && !errors.some((e) => e.includes("primary_muscles"))) warnings.push("No primary muscle: this exercise won't count toward weekly sets per muscle.");

  const sets = int(get("sets"), "Sets", 1, 20, errors) ?? 3;
  const repMin = int(get("rep_min"), "Rep min", 1, 100, errors) ?? 8;
  const repMax = int(get("rep_max"), "Rep max", 1, 100, errors) ?? Math.max(12, repMin);
  if (repMin > repMax) errors.push("Rep min must be at most rep max.");
  const rest = int(get("rest_seconds"), "Rest", 0, 1800, errors) ?? (category === "compound" ? 120 : 90);

  let increment = weightEntry ? GENERIC_INCREMENT_KG[weightEntry] : 2.5;
  let incrementGeneric = true;
  if (get("increment_kg").trim()) {
    const n = Number(get("increment_kg").trim().replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 50) errors.push("Increment must be a number of kg above 0 and at most 50.");
    else { increment = n; incrementGeneric = false; }
  }

  let e1rm = false;
  const e1rmRaw = get("e1rm").trim().toLowerCase();
  if (e1rmRaw) {
    if (["yes", "y", "true", "1"].includes(e1rmRaw)) e1rm = true;
    else if (!["no", "n", "false", "0"].includes(e1rmRaw)) errors.push('e1rm must be "yes" or "no".');
  }
  if (e1rm && loadType && category && !e1rmAllowed({ loadType, category })) {
    errors.push("Estimated 1RM is only available for compound exercises with external load.");
  }

  if (equipment && loadType && weightEntry) {
    const problem = conventionProblem({ equipment, loadType, weightEntry });
    if (problem) errors.push(problem);
  }

  const instructions = cleanText(get("instructions"), { multiline: true });
  const notes = cleanText(get("notes"), { multiline: true });
  if (instructions.length > 1000) errors.push("Instructions must be at most 1000 characters.");
  if (notes.length > 1000) errors.push("Notes must be at most 1000 characters.");
  const aliases = list(get("aliases")).filter((a) => a.length <= 120).slice(0, 10);

  const ok = errors.length === 0 && equipment && loadType && weightEntry && category;
  return {
    line, raw: raw as Record<string, string>, status: ok ? "valid" : "error", errors, warnings,
    draft: ok ? {
      name, aliases, primary_muscles: primary, secondary_muscles: secondary,
      equipment, category, load_type: loadType!, weight_convention: weightEntry!,
      progression: defaultProgression(category, loadType!),
      e1rm_eligible: e1rm, default_sets: sets, default_rep_min: repMin, default_rep_max: repMax, default_rest_s: rest,
      increment_kg: increment, increment_is_generic: incrementGeneric,
      instructions: instructions || null, notes: notes || null,
    } : null,
  };
}

/** Mark rows whose name matches the library or an earlier row; flag catalog look-alikes. */
export function classifyDuplicates(rows: ImportRow[], existing: ExistingExercise[], catalog: readonly CatalogExercise[] = []): ImportRow[] {
  const lib = new Map(existing.map((e) => [nameKey(e.name), e]));
  const cat = new Map<string, CatalogExercise>();
  for (const c of catalog) for (const n of [c.name, ...c.aliases]) if (!cat.has(nameKey(n))) cat.set(nameKey(n), c);
  const seen = new Map<string, string>();
  return rows.map((r) => {
    const out: ImportRow = { ...r, warnings: r.warnings.filter((w) => !w.startsWith("Same as catalog")), duplicateOf: undefined };
    if (!r.draft) return out;
    const k = nameKey(r.draft.name);
    const hit = lib.get(k);
    if (hit) return { ...out, status: "duplicate", duplicateOf: { kind: "library", name: hit.name, archived: hit.archived } };
    if (seen.has(k)) return { ...out, status: "duplicate", duplicateOf: { kind: "file", name: seen.get(k)! } };
    seen.set(k, r.draft.name);
    const c = cat.get(k);
    if (c) out.warnings = [...out.warnings, `Same as catalog exercise "${c.name}". Adding it from the catalog keeps its settings.`];
    return { ...out, status: "valid" };
  });
}

/** Re-validate one row after the user renames it in the preview. */
export function renameRow(rows: ImportRow[], line: number, name: string, existing: ExistingExercise[], catalog: readonly CatalogExercise[] = []): ImportRow[] {
  const next = rows.map((r) => (r.line === line ? validateRow({ ...r.raw, name }, r.line) : r));
  return classifyDuplicates(next, existing, catalog);
}

export const TEMPLATE_CSV = [
  IMPORT_COLUMNS.join(","),
  'Landmine Press,landmine shoulder press,barbell,external,total,front_delts;upper_chest,triceps,compound,3,8,12,120,2.5,no,"Half-kneeling or standing; press up and slightly forward.",',
  "Dumbbell Pullover,,dumbbell,external,per_dumbbell,lats;chest,triceps,isolation,3,10,15,90,,no,,",
  'Ring Dip,,bodyweight,bodyweight,added,chest;triceps,front_delts,bodyweight,3,5,10,120,,no,,"Enter 0 kg for bodyweight only."',
  "Assisted Chin-Up (Band),,bodyweight,assisted,assistance,lats;biceps,upper_back,bodyweight,3,5,10,120,,no,,Log the band's rating as assistance.",
].join("\n") + "\n";
