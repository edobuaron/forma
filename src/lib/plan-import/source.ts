// Source → draft, for each kind of input. Pure (the XLSX bytes are read by grid.readXlsx beforehand).
import { buildDraft, findHeaderRow, gridToRows, guessMapping, textToRows, type BuildContext, type GridRows } from "./extract";
import { detectTable, type Grid } from "./grid";
import type { GridSource, PlanDraft, PlanField, SourceKind } from "./types";

export function gridSourceFor(sheets: { name: string; rows: Grid }[]): GridSource {
  // Several sheets that each look like a table are read together (usually one sheet per day).
  const withHeader = sheets.map((s, i) => [i, findHeaderRow(s.rows)] as const).filter(([, h]) => h != null);
  const sheet = sheets.length > 1 && withHeader.length === sheets.length ? -1 : (withHeader[0]?.[0] ?? 0);
  const one = sheets[Math.max(0, sheet)];
  const headerRow = findHeaderRow(one.rows);
  return { sheets, sheet, headerRow, mapping: guessMapping(one.rows, headerRow) };
}

function rowsFromGrid(g: GridSource): GridRows {
  if (g.sheet === -1) {
    const all: GridRows = { rows: [], notes: [], notices: [] };
    for (const s of g.sheets) {
      const h = findHeaderRow(s.rows);
      const r = gridToRows(s.rows, h, guessMapping(s.rows, h), s.name);
      all.rows.push(...r.rows); all.notes.push(...r.notes); all.notices.push(...r.notices.map((n) => `${s.name}: ${n}`));
    }
    return all;
  }
  const s = g.sheets[g.sheet];
  return gridToRows(s.rows, g.headerRow, g.mapping, g.sheets.length > 1 ? s.name : undefined);
}

export function draftFromGrid(importId: string, kind: SourceKind, name: string | null, g: GridSource, ctx: BuildContext, programName?: string): PlanDraft {
  const r = rowsFromGrid(g);
  return { ...buildDraft({ importId, sourceKind: kind, sourceName: name, ...r, programName }, ctx), grid: g };
}

/** Pasted text or a .csv/.tsv/.txt file: a table when it looks like one, otherwise one exercise per line. */
export function draftFromText(importId: string, kind: SourceKind, name: string | null, text: string, ctx: BuildContext): PlanDraft {
  const table = detectTable(text);
  if (table && table.grid.length > 0 && table.grid[0].length >= 2) {
    const g = gridSourceFor([{ name: "Table", rows: table.grid }]);
    return draftFromGrid(importId, kind, name, g, ctx);
  }
  return { ...buildDraft({ importId, sourceKind: kind, sourceName: name, ...textToRows(text) }, ctx), text };
}

/** Re-read a grid with a different sheet, header row or column mapping. Edits to the table are replaced. */
export function remap(draft: PlanDraft, patch: Partial<Pick<GridSource, "sheet" | "headerRow" | "mapping">>, ctx: BuildContext): PlanDraft {
  const g = draft.grid!;
  let next: GridSource = { ...g, ...patch };
  if (patch.sheet != null && patch.sheet !== g.sheet && patch.sheet >= 0) {
    const rows = g.sheets[patch.sheet].rows;
    const headerRow = findHeaderRow(rows);
    next = { ...next, headerRow, mapping: guessMapping(rows, headerRow) };
  }
  if (patch.headerRow !== undefined && patch.mapping === undefined && next.sheet >= 0) {
    next = { ...next, mapping: guessMapping(g.sheets[next.sheet].rows, patch.headerRow) };
  }
  return draftFromGrid(draft.importId, draft.sourceKind, draft.sourceName, next, ctx, draft.programName);
}

export function emptyDraft(importId: string): PlanDraft {
  return {
    version: 1, importId, programName: "New program", sourceKind: "manual", sourceName: null,
    workouts: [{ id: crypto.randomUUID(), name: "Workout 1", source: null, warmupNotes: null, exercises: [] }],
    notes: [], notices: [],
  };
}

export const MAPPABLE_FIELDS: PlanField[] = [
  "workout", "order", "exercise", "setsReps", "sets", "reps", "rest", "load", "rir", "rpe", "effort", "tempo", "notes",
];
