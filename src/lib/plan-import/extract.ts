// From grid or text to SourceRows, and from SourceRows to a reviewable PlanDraft. Pure.
import type { CatalogExercise } from "@/lib/catalog/catalog";
import { cleanText } from "@/lib/catalog/names";
import { cellLabel, type Grid } from "./grid";
import { matchExercise, type LibraryEntry } from "./match";
import { interpretRow, norm } from "./notation";
import {
  MAX_EXERCISES_PER_WORKOUT, MAX_ROWS, MAX_WORKOUTS, type DraftExercise, type DraftWorkout, type Flag, type PlanDraft,
  type PlanField, type SourceKind, type SourceRow,
} from "./types";

// ---------- column mapping ----------
const HEADER_ALIASES: [PlanField, RegExp][] = [
  ["setsReps", /^(?:sets?\s*(?:x|×|\/|&|and|e)\s*reps?|serie\s*(?:x|×|\/|e)\s*rip(?:etizioni)?|scheme|schema|prescription|prescrizione|volume|set\s*rep)$/],
  ["workout", /^(?:day|days|giorno|workout|allenamento|session|sessione|seduta|scheda|training|tag|jour|dia|día)$/],
  ["order", /^(?:order|#|no|n|n°|nr|ordine|sequence|seq|ss|superset|group|gruppo|ord)$/],
  ["exercise", /^(?:exercises?|esercizi[oi]?|movements?|movimento|name|nome|übung|exercice|ejercicio|lift|esercizio\s*\/\s*exercise)$/],
  ["sets", /^(?:sets?|serie|series|sätze|séries|n\s*serie|working\s*sets)$/],
  ["reps", /^(?:reps?|rip|ripetizioni|repetitions?|wdh|répétitions|repeticiones|rep\s*range)$/],
  ["rest", /^(?:rest|recupero|rec|riposo|pausa|pause|rest\s*time|recovery|descanso|repos|rest\s*period)$/],
  ["load", /^(?:load|weight|kg|lbs?|peso|carico|charge|gewicht|carga)$/],
  ["rir", /^(?:rir|buffer|reps?\s*in\s*reserve)$/],
  ["rpe", /^(?:rpe)$/],
  ["effort", /^(?:intensity|intensit[aà]|effort|sforzo|@|target)$/],
  ["tempo", /^(?:tempo|cadence|cadenza|tut)$/],
  ["notes", /^(?:notes?|comments?|commenti|instructions?|istruzioni|cues?|remarks?|osservazioni|technique|tecnica|notes?\s*\/\s*cues?)$/],
];

/** Strip a unit in brackets or a trailing unit from a header: "Rest (min)", "Load kg", "Recupero secondi". */
function headerParts(h: string): { base: string; restUnit?: "s" | "min"; loadUnit?: "kg" | "lb" } {
  let base = norm(h).replace(/[.:]+$/, "");
  let restUnit: "s" | "min" | undefined;
  let loadUnit: "kg" | "lb" | undefined;
  const unit = base.match(/\s*(?:\(([^)]*)\)|\[([^\]]*)\]|\s(s|sec|secs|seconds?|secondi|min|mins|minutes?|minuti|kg|lbs?))$/);
  if (unit) {
    const u = (unit[1] ?? unit[2] ?? unit[3] ?? "").trim();
    if (/^(?:s|sec|secs|seconds?|secondi|")$/.test(u)) restUnit = "s";
    if (/^(?:m|min|mins|minutes?|minuti|')$/.test(u)) restUnit = "min";
    if (/^(?:kg|kgs)$/.test(u)) loadUnit = "kg";
    if (/^(?:lb|lbs|pounds?)$/.test(u)) loadUnit = "lb";
    if (restUnit || loadUnit || unit[1] != null || unit[2] != null) base = base.slice(0, unit.index).trim();
  }
  if (base === "kg") loadUnit = "kg";
  if (base === "lb" || base === "lbs") loadUnit = "lb";
  return { base, restUnit, loadUnit };
}

export function fieldForHeader(h: string): PlanField | null {
  const { base } = headerParts(h);
  if (!base) return null;
  for (const [field, re] of HEADER_ALIASES) if (re.test(base)) return field;
  return null;
}

const WEEK_HEADER = /^(?:week|wk|w|settimana|sett|woche|semaine|semana)\s*\d+$/;

/** The first row (within the first 15) that names at least two known columns including the exercise. */
export function findHeaderRow(grid: Grid): number | null {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const fields = grid[r].map(fieldForHeader);
    if (fields.filter(Boolean).length >= 2 && fields.includes("exercise")) return r;
  }
  return null;
}

/** Map each column to a field. With no header, guess from content: a text column and a notation column. */
export function guessMapping(grid: Grid, headerRow: number | null): (PlanField | null)[] {
  const width = grid[0]?.length ?? 0;
  if (headerRow != null) {
    const used = new Set<PlanField>();
    return grid[headerRow].map((h) => {
      const f = fieldForHeader(h);
      if (!f || used.has(f)) return null; // a second "Reps" column (week 2…) is ignored until the user maps it
      used.add(f);
      return f;
    });
  }
  const body = grid.filter((r) => r.filter(Boolean).length >= 2);
  const score = (col: number, re: RegExp) => body.filter((r) => re.test(norm(r[col] ?? ""))).length;
  const mapping: (PlanField | null)[] = Array(width).fill(null);
  let best = -1, bestScore = 0;
  for (let c = 0; c < width; c++) {
    const s = score(c, /\d+\s*x\s*\d+|\d+\s*sets?/);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  if (best >= 0) mapping[best] = "setsReps";
  let nameCol = -1, nameScore = 0;
  for (let c = 0; c < width; c++) {
    if (c === best) continue;
    const s = score(c, /[a-zà-ÿ]{3,}/);
    if (s > nameScore) { nameCol = c; nameScore = s; }
  }
  if (nameCol >= 0) mapping[nameCol] = "exercise";
  for (let c = 0; c < width; c++) {
    if (mapping[c]) continue;
    if (score(c, /^\d+(?:[.,]\d+)?\s*(?:s|sec|min|'|")$|^\d{1,2}:\d\d$/) >= body.length / 2 && body.length) mapping[c] = "rest";
    else if (score(c, /^\d+(?:[.,]\d+)?\s*(?:kg|lb|lbs)$/) >= body.length / 2 && body.length) mapping[c] = "load";
  }
  return mapping;
}

const HEADING = /^(?:day|giorno|workout|allenamento|session|sessione|seduta|scheda|week|settimana|upper|lower|push|pull|legs?|gambe|full[\s-]?body|total[\s-]?body|chest|back|arms|shoulders|petto|dorso|schiena|spalle|braccia|glutes|glutei|tag|jour|d[ií]a|workout\s+[a-z])\b/i;

export function looksLikeHeading(text: string): boolean {
  const t = cleanText(text);
  if (!t || t.length > 80) return false;
  if (/\d+\s*[x×]\s*\d+/i.test(t)) return false;
  return HEADING.test(t) || /:$/.test(t) || /^[A-Z][A-Z0-9 &/+-]{2,}$/.test(t) || /^[A-E]$/.test(t);
}

function headingName(text: string): string {
  return cleanText(text).replace(/[:\s]+$/, "").replace(/^[#*\-\s]+/, "").slice(0, 120);
}

export interface GridRows {
  rows: SourceRow[];
  /** Text above the table and other non-exercise lines. */
  notes: string[];
  notices: string[];
}

/** Grid → rows. Headings, a workout column, or blank-separated blocks start new workouts. */
export function gridToRows(grid: Grid, headerRow: number | null, mapping: (PlanField | null)[], sheetName?: string): GridRows {
  const out: GridRows = { rows: [], notes: [], notices: [] };
  const header = headerRow != null ? grid[headerRow] : null;
  const prefix = sheetName ? `${sheetName}!` : "";
  const units = header ? header.map(headerParts) : [];
  const restUnit = units.find((u, i) => mapping[i] === "rest")?.restUnit;
  const loadUnit = units.find((u, i) => mapping[i] === "load")?.loadUnit;

  if (header) {
    const weeks = header.filter((h) => WEEK_HEADER.test(norm(h)));
    if (weeks.length > 1) {
      out.notices.push(`This plan has ${weeks.length} week columns (${weeks.join(", ")}). A Forma program has one prescription per exercise, so only the column mapped below is imported. Change the mapping to use a different week.`);
    }
    const unmapped = header.filter((h, i) => h && !mapping[i]);
    if (unmapped.length) out.notices.push(`Not imported: ${unmapped.join(", ")}. Map these columns below if they matter.`);
    for (let r = 0; r < headerRow!; r++) {
      const text = grid[r].filter(Boolean).join(" · ");
      if (text) out.notes.push(text);
    }
  }

  let workout = sheetName ?? "";
  let blankBefore = false;
  const start = headerRow != null ? headerRow + 1 : 0;
  const isHeaderRepeat = (r: string[]) => r.map(fieldForHeader).filter(Boolean).length >= 2;
  const exCol = mapping.indexOf("exercise");
  for (let r = start; r < grid.length && out.rows.length < MAX_ROWS; r++) {
    const row = grid[r];
    const filled = row.map((c, i) => [c, i] as const).filter(([c]) => c);
    if (filled.length === 0) { blankBefore = true; continue; }
    if (isHeaderRepeat(row)) { blankBefore = false; continue; }
    const cells: SourceRow["cells"] = {};
    const headers: SourceRow["headers"] = {};
    mapping.forEach((f, i) => {
      if (!f || !row[i]) return;
      cells[f] = cells[f] ? `${cells[f]} ${row[i]}` : row[i];
      headers[f] = header?.[i] || f;
    });
    const ref = { label: `${prefix}${cellLabel(r, exCol >= 0 ? exCol : filled[0][1])}`, text: filled.map(([c]) => c).join(" | ") };

    if (cells.workout && headingName(cells.workout) !== workout) workout = headingName(cells.workout);
    const onlyOne = filled.length === 1;
    const single = filled[0][0];
    const singleIsName = onlyOne && filled[0][1] === exCol;
    if (onlyOne && (!singleIsName || looksLikeHeading(single) || (blankBefore && !/\d/.test(single) && /:$/.test(single)))) {
      if (!cells.workout) {
        if (singleIsName || looksLikeHeading(single)) workout = headingName(single);
        else out.notes.push(single);
      }
      blankBefore = false;
      continue;
    }
    blankBefore = false;
    if (!cells.exercise) {
      // A row with values but no exercise: keep its text as a plan note.
      if (!cells.workout) out.notes.push(ref.text);
      continue;
    }
    out.rows.push({ ref, workout: workout || undefined, cells, headers, restUnit, loadUnit });
  }
  return out;
}

const NOTATION_START = /(\d+\s*(?:x|×|\*)\s*(?:\d|amrap|max)|\d+\s*(?:sets?|serie|series)\b)/i;

/** Free text, one exercise per line ("Bench press 3x8-10 rest 2 min"). */
export function textToRows(text: string): GridRows {
  const out: GridRows = { rows: [], notes: [], notices: [] };
  let workout = "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length && out.rows.length < MAX_ROWS; i++) {
    const raw = cleanText(lines[i]);
    if (!raw) continue;
    const line = raw.replace(/^(?:[-*•·▪◦]|\d{1,2}[.)])\s+/, "");
    const ref = { label: `Line ${i + 1}`, text: raw };
    const noteLine = line.match(/^(?:notes?|nota|cue|tip|n\.?b\.?)\s*[:\-]\s*(.+)$/i);
    if (noteLine) {
      const prev = out.rows[out.rows.length - 1];
      if (prev) prev.cells.notes = prev.cells.notes ? `${prev.cells.notes} ${noteLine[1]}` : noteLine[1];
      else out.notes.push(noteLine[1]);
      continue;
    }
    const m = line.match(NOTATION_START);
    if (!m && looksLikeHeading(line)) { workout = headingName(line); continue; }
    // Text before the first workout heading with no prescription in it is a title or an introduction.
    if (!m && !workout && out.rows.length === 0 && !/\d+\s*(?:x|×|sets?|serie|reps?)\b/i.test(line)) { out.notes.push(raw); continue; }
    let name = line, tail = "";
    if (m && m.index! > 0) { name = line.slice(0, m.index); tail = line.slice(m.index); }
    else if (!m) {
      const sep = line.match(/\s[-–—:|]\s|:\s/);
      if (sep) { name = line.slice(0, sep.index); tail = line.slice(sep.index! + sep[0].length); }
    } else {
      // Notation first ("3x10 Bench press"): the name is what follows.
      const after = line.slice(m[0].length).match(/^[\d\s\-–]*(?:reps?)?\s*([A-Za-zÀ-ÿ].*)$/);
      if (after) { name = after[1]; tail = line.slice(0, line.length - after[1].length); }
    }
    name = name.replace(/[\s:;,\-–—|]+$/, "");
    if (!name) { out.notes.push(raw); continue; }
    out.rows.push({ ref, workout: workout || undefined, cells: { exercise: name, ...(tail ? { setsReps: tail } : {}) }, headers: { exercise: "Text", setsReps: "Text" } });
  }
  return out;
}

// ---------- building the draft ----------
export interface BuildContext {
  library: LibraryEntry[];
  catalog: readonly CatalogExercise[];
  newId: () => string;
}

function matchFlags(m: DraftExercise["match"], name: string): Flag[] {
  if (m.status === "confirmed") return [];
  if (m.status === "proposed") {
    return [{ id: `m-${name}`, field: "exercise", code: "exercise_proposed", blocking: true, message: `Is this “${m.choice!.name}”? Confirm or choose another exercise.` }];
  }
  return [{ id: `m-${name}`, field: "exercise", code: "exercise_unmatched", blocking: true, message: "No matching exercise. Choose one or create a custom exercise." }];
}

export function rowToExercise(row: SourceRow, ctx: BuildContext): { exercise: DraftExercise | null; warmup: string | null; supersetLabel: string | null } {
  const it = interpretRow(row);
  if (it.warmupRow) return { exercise: null, warmup: row.ref.text, supersetLabel: null };
  const name = it.name || row.nameSuggestion || "";
  const match = matchExercise(name, ctx.library, ctx.catalog, row.nameSuggestion);
  const original = (Object.entries(row.cells) as [PlanField, string][])
    .map(([f, text]) => ({ label: row.headers?.[f] ?? f, text }));
  const ex: DraftExercise = {
    id: ctx.newId(),
    source: row.ref,
    original,
    name,
    match,
    ...it.values,
    origin: { ...it.origin, name: "extracted" },
    flags: [...matchFlags(match, name), ...it.flags],
  };
  return { exercise: ex, warmup: null, supersetLabel: it.supersetLabel };
}

/** Group rows into workouts, interpret them, match exercises and assign supersets. */
export function buildDraft(input: {
  importId: string; sourceKind: SourceKind; sourceName: string | null; rows: SourceRow[]; notes: string[]; notices: string[];
  programName?: string;
}, ctx: BuildContext): PlanDraft {
  const workouts: DraftWorkout[] = [];
  const labels = new Map<string, (string | null)[]>();
  const notices = [...input.notices];
  for (const row of input.rows) {
    const wname = row.workout?.trim() || "Workout 1";
    let w = workouts.find((x) => x.name === wname);
    if (!w) {
      if (workouts.length >= MAX_WORKOUTS) { notices.push(`Only the first ${MAX_WORKOUTS} workouts were read.`); break; }
      w = { id: ctx.newId(), name: wname, source: row.ref, warmupNotes: null, exercises: [] };
      workouts.push(w);
      labels.set(w.id, []);
    }
    const r = rowToExercise(row, ctx);
    if (r.warmup) { w.warmupNotes = [w.warmupNotes, r.warmup].filter(Boolean).join("\n").slice(0, 1000); continue; }
    if (!r.exercise) continue;
    if (w.exercises.length >= MAX_EXERCISES_PER_WORKOUT) { notices.push(`“${w.name}” has more than ${MAX_EXERCISES_PER_WORKOUT} exercises; the rest weren't read.`); continue; }
    w.exercises.push(r.exercise);
    labels.get(w.id)!.push(r.supersetLabel);
  }
  // A letter shared by two or more exercises in a workout is a superset; a lone "A1" is just order.
  for (const w of workouts) {
    const ls = labels.get(w.id)!;
    w.exercises.forEach((e, i) => {
      const l = ls[i];
      if (l && ls.filter((x) => x === l).length >= 2) { e.supersetGroup = l; e.origin.supersetGroup = "extracted"; }
    });
  }
  const fileName = input.sourceName?.replace(/\.[a-z0-9]+$/i, "").trim();
  const programName = (input.programName || input.notes[0] || fileName || "Imported plan").slice(0, 120);
  return {
    version: 1,
    importId: input.importId,
    programName,
    sourceKind: input.sourceKind,
    sourceName: input.sourceName,
    workouts: workouts.filter((w) => w.exercises.length || w.warmupNotes),
    notes: input.notes.slice(0, 50).map((n) => n.slice(0, 500)),
    notices,
  };
}
