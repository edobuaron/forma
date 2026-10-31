// Reading a plan's notation: "3×8–10", "4 sets of 6", "90s", "2'", "1:30", "RPE 8", "2 RIR", "60,5 kg",
// "3×10 each side", "+ drop set", "2 warm-up sets", "A1". Pure; no I/O.
//
// Rules that must never bend:
//  * RPE and RIR are different scales. A number is only ever stored as the one the plan names; an
//    unlabelled effort number is a question for the user, never a conversion.
//  * Minutes and seconds are never guessed. A bare rest number is a question unless a header states the
//    unit, or only one reading is a valid rest (90 minutes isn't).
//  * "3×10 each side" is 3 planned sets of 10 per side, not 6 sets.
//  * "3×12/10/8" (different reps per set) is asked, not averaged or flattened.
//  * Anything Forma can't represent stays visible in notes and is flagged.
import { KG_PER_LB, round } from "@/lib/domain/units";
import { cleanText } from "@/lib/catalog/names";
import { EMPTY_VALUES, type DraftValues, type Flag, type FlagOption, type Origin, type SourceRow } from "./types";

export interface Interpretation {
  name: string;
  values: DraftValues;
  origin: Partial<Record<keyof DraftValues | "name", Origin>>;
  flags: Flag[];
  /** Superset label from an order column or a name prefix ("A1" → "A"). Assigned per workout later. */
  supersetLabel: string | null;
  /** The row is a general warm-up instruction ("Warm-up: 5 min bike"), not an exercise. */
  warmupRow: boolean;
}

/** Lowercase, unify ×/x, dashes, primes and spaces. Positions don't need to match the original. */
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[×✕✖*]/g, "x")
    .replace(/[–—−]/g, "-")
    .replace(/[’‘´`]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** "62,5" and "62.5" → 62.5. Thousands separators aren't plausible in a plan and aren't accepted. */
export function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const RANGE_SEP = String.raw`\s*(?:-|to|a|bis|à)\s*`;

let flagSeq = 0;
function flag(f: Omit<Flag, "id">): Flag {
  flagSeq += 1;
  return { id: `f${flagSeq}`, ...f };
}

// ---------- sets and reps ----------
interface SetsReps {
  sets: number | null;
  repMin: number | null;
  repMax: number | null;
  flags: Flag[];
  note: string | null;
  rest: string; // the text with recognised notation blanked out
}

function blank(s: string, re: RegExp): string {
  return s.replace(re, " ");
}

/** A combined "sets × reps" cell, or separate sets/reps cells joined as "3 x 10". */
export function parseSetsReps(text: string): SetsReps {
  let t = norm(text);
  const out: SetsReps = { sets: null, repMin: null, repMax: null, flags: [], note: null, rest: t };

  // Different reps per set: "3x12/10/8", "12-10-8" after an x, "3x 12,10,8".
  // Slashes always mean per-set reps; commas and dashes only with three or more numbers ("12,10,8",
  // "12-10-8"), so "3x10, 2 min" and "3x8-10" keep their usual meaning.
  const pyr = t.match(/(?:^|(\d+)\s*x\s*)(\d+(?:\s*\/\s*\d+){1,9}|\d+(?:\s*,\s*\d+){2,9}|\d+(?:\s*-\s*\d+){2,9})(?![\d.,]|\s*(?:kg|lb|%))/);
  if (pyr) {
    const reps = pyr[2].split(/\s*[/,-]\s*/).map(Number);
    if (pyr[1]) out.sets = Number(pyr[1]);
    const lo = Math.min(...reps), hi = Math.max(...reps);
    out.flags.push(flag({
      field: "reps", code: "ambiguous_reps", blocking: true,
      message: `The plan gives different reps per set (${reps.join("/")}). Forma stores one rep range per exercise.`,
      options: [{ label: `Use ${lo}–${hi} reps`, patch: { repMin: lo, repMax: hi } }],
    }));
    out.note = `Reps per set as written: ${reps.join("/")}`;
    out.rest = blank(t, new RegExp(escape(pyr[0])));
    return out;
  }

  const timeUnit = String.raw`(?:s|sec|secs|seconds?|secondi|"|min|mins|minutes?|minuti|m|')`;
  const timed = t.match(new RegExp(String.raw`(\d+)\s*x\s*(${NUM})\s*(${timeUnit})(?![a-z])`));
  if (timed) {
    out.sets = Number(timed[1]);
    out.flags.push(flag({
      field: "reps", code: "time_based", blocking: true,
      message: `This is timed (${timed[2]} ${timed[3]}), and Forma counts reps. Enter reps or leave this exercise out.`,
    }));
    out.note = `Timed: ${timed[0]}`;
    out.rest = blank(t, new RegExp(escape(timed[0])));
    return out;
  }

  const amrap = t.match(/(?:(\d+)\s*x\s*)?(amrap|max(?:imum)? reps|max|to failure|al cedimento|cedimento)\b/);
  if (amrap && (amrap[1] || !/\d+\s*x\s*\d+/.test(t))) {
    if (amrap[1]) out.sets = Number(amrap[1]);
    out.flags.push(flag({
      field: "reps", code: "amrap", blocking: true,
      message: "The plan says as many reps as possible. Enter the rep range you want to aim for.",
    }));
    out.note = `As written: ${amrap[0]}`;
    out.rest = blank(t, new RegExp(escape(amrap[0])));
    return out;
  }

  const patterns: RegExp[] = [
    new RegExp(String.raw`(\d+)\s*(?:sets?|serie|series|sätze|séries)\s*(?:of|da|di|de|x|à|mit)?\s*(\d+)(?:${RANGE_SEP}(\d+))?\s*(?:reps?|rip(?:etizioni)?|wdh|répétitions)?`),
    new RegExp(String.raw`(\d+)\s*x\s*(\d+)(?:${RANGE_SEP}(\d+))?`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    out.sets = Number(m[1]);
    out.repMin = Number(m[2]);
    out.repMax = m[3] ? Number(m[3]) : Number(m[2]);
    if (out.repMin > out.repMax) [out.repMin, out.repMax] = [out.repMax, out.repMin];
    t = blank(t, re);
    out.rest = t;
    return out;
  }
  return out;
}

export function parseSets(text: string): { sets: number | null; rest: string } {
  const t = norm(text);
  const m = t.match(/^(\d+)\s*(?:sets?|serie|series)?\b/);
  return m ? { sets: Number(m[1]), rest: t.slice(m[0].length) } : { sets: null, rest: t };
}

/** A reps cell. It may hold the whole "3x8-10" notation, in which case its set count is returned too. */
export function parseReps(text: string): SetsReps {
  const t = norm(text);
  const pyrOrSpecial = parseSetsReps(t);
  if (pyrOrSpecial.flags.length || pyrOrSpecial.sets != null) return pyrOrSpecial;
  const m = t.match(new RegExp(String.raw`^(\d+)(?:${RANGE_SEP}(\d+))?`));
  const out: SetsReps = { sets: null, repMin: null, repMax: null, flags: [], note: null, rest: t };
  if (m) {
    out.repMin = Number(m[1]);
    out.repMax = m[2] ? Number(m[2]) : out.repMin;
    if (out.repMin > out.repMax) [out.repMin, out.repMax] = [out.repMax, out.repMin];
    out.rest = t.slice(m[0].length);
  }
  return out;
}

// ---------- rest ----------
export interface RestResult {
  restS: number | null;
  origin: Origin | null;
  flags: Flag[];
  matched: string | null;
}

function toSeconds(n: number, unit: "s" | "min") {
  return Math.round(unit === "min" ? n * 60 : n);
}

const SEC_UNITS = /^(?:s|sec|secs|second|seconds|secondi|sek|"|'')$/;
const MIN_UNITS = /^(?:m|min|mins|minute|minutes|minuti|minuto|')$/;

/** A rest value: "90s", "90\"", "2 min", "2'", "1'30\"", "1:30", "1,5 min", "60-90 s", or a bare number. */
export function parseRest(text: string, unitHint?: "s" | "min"): RestResult {
  const t = norm(text);
  const res: RestResult = { restS: null, origin: null, flags: [], matched: null };
  if (!t) return res;

  const clock = t.match(/(\d{1,2}):([0-5]\d)(?!\d)/);
  if (clock) return { restS: Number(clock[1]) * 60 + Number(clock[2]), origin: "interpreted", flags: [], matched: clock[0] };
  const primes = t.match(/(\d+)\s*'\s*(\d+)\s*(?:"|'')?/);
  if (primes) return { restS: Number(primes[1]) * 60 + Number(primes[2]), origin: "interpreted", flags: [], matched: primes[0] };

  const unitRe = String.raw`(s|sec|secs|seconds?|secondi|sek|"|''|m|min|mins|minutes?|minuti|minuto|')`;
  const range = t.match(new RegExp(String.raw`(${NUM})${RANGE_SEP}(${NUM})\s*${unitRe}?(?![a-z])`));
  if (range) {
    const unit = range[3] ? (SEC_UNITS.test(range[3]) ? "s" : "min") : unitHint;
    if (unit) {
      const lo = toSeconds(parseNumber(range[1])!, unit), hi = toSeconds(parseNumber(range[2])!, unit);
      res.flags.push(flag({
        field: "rest", code: "rest_range", blocking: true,
        message: `The plan gives a rest range (${range[0].trim()}). Forma stores one rest time.`,
        options: [{ label: `${fmtRest(lo)}`, patch: { restS: lo } }, { label: `${fmtRest(hi)}`, patch: { restS: hi } }],
      }));
      res.matched = range[0];
      return res;
    }
  }

  const single = t.match(new RegExp(String.raw`(${NUM})\s*${unitRe}?(?![a-z\d])`));
  if (!single) return res;
  const n = parseNumber(single[1]);
  if (n == null) return res;
  res.matched = single[0];
  const unit = single[2] ? (SEC_UNITS.test(single[2]) ? "s" : MIN_UNITS.test(single[2]) ? "min" : null) : unitHint ?? null;
  if (unit) {
    res.restS = toSeconds(n, unit);
    res.origin = "extracted";
    return res;
  }
  // No unit anywhere. Ask, unless only one reading is a valid rest (0–30 min).
  if (n * 60 > 1800) {
    res.restS = Math.round(n);
    res.origin = "interpreted";
    res.flags.push(flag({
      field: "rest", code: "rest_unit", blocking: false, resolved: false,
      message: `No unit given; read as ${n} seconds (${n} minutes isn't a valid rest).`,
    }));
    return res;
  }
  res.flags.push(flag({
    field: "rest", code: "rest_unit", blocking: true,
    message: `Rest “${single[1]}” has no unit. Seconds or minutes?`,
    options: [{ label: `${n} seconds`, patch: { restS: Math.round(n) } }, { label: `${n} min`, patch: { restS: toSeconds(n, "min") } }],
  }));
  return res;
}

export function fmtRest(s: number): string {
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

// ---------- effort ----------
interface EffortResult {
  targetRir: number | null;
  targetRpe: number | null;
  flags: Flag[];
  matched: string[];
}

function effortValue(kind: "rir" | "rpe", a: string, b: string | undefined, raw: string): { value: number | null; flag?: Flag } {
  const lo = parseNumber(a), hi = b ? parseNumber(b) : null;
  const max = 10, min = kind === "rpe" ? 1 : 0;
  const ok = (n: number | null) => n != null && n >= min && n <= max;
  const key = kind === "rir" ? "targetRir" : "targetRpe";
  const label = kind.toUpperCase();
  if (hi != null && lo != null && ok(lo) && ok(hi)) {
    return {
      value: null,
      flag: flag({
        field: "effort", code: "effort_range", blocking: true,
        message: `The plan gives a ${label} range (${raw.trim()}). Forma stores one target.`,
        options: [{ label: `${label} ${lo}`, patch: { [key]: lo } as Partial<DraftValues> }, { label: `${label} ${hi}`, patch: { [key]: hi } as Partial<DraftValues> }],
      }),
    };
  }
  if (!ok(lo)) {
    return { value: null, flag: flag({ field: "effort", code: "effort_unclear", blocking: true, message: `“${raw.trim()}” isn't a valid ${label}.` }) };
  }
  return { value: lo };
}

/** RIR, RPE or an unlabelled effort number. `column` says which one a column header named. */
export function parseEffort(text: string, column?: "rir" | "rpe" | "effort"): EffortResult {
  const t = norm(text);
  const out: EffortResult = { targetRir: null, targetRpe: null, flags: [], matched: [] };
  if (!t) return out;
  const n = String.raw`(\d+(?:[.,]5)?)`;
  const labelled: [RegExp, "rir" | "rpe"][] = [
    [new RegExp(String.raw`\brpe\s*[:=@]?\s*${n}(?:${RANGE_SEP}${n})?`), "rpe"],
    [new RegExp(String.raw`(?<!x\s*)(?<![\d.,])${n}(?:${RANGE_SEP}${n})?\s*rpe\b`), "rpe"],
    [new RegExp(String.raw`\b(?:rir|buffer)\s*[:=]?\s*${n}(?:${RANGE_SEP}${n})?`), "rir"],
    [new RegExp(String.raw`(?<!x\s*)(?<![\d.,])${n}(?:${RANGE_SEP}${n})?\s*(?:rir|reps? in reserve|buffer)\b`), "rir"],
  ];
  const seen = new Set<string>();
  for (const [re, kind] of labelled) {
    if (seen.has(kind)) continue;
    const m = t.match(re);
    if (!m) continue;
    seen.add(kind);
    const r = effortValue(kind, m[1], m[2], m[0]);
    if (kind === "rir") out.targetRir = r.value; else out.targetRpe = r.value;
    if (r.flag) out.flags.push(r.flag);
    out.matched.push(m[0]);
  }
  if (out.matched.length) return out;

  // "@8" is used for RPE by some coaches and for other things by others: ask.
  const at = t.match(/@\s*(\d+(?:[.,]5)?)(?![\d.,])(?!\s*(?:kg|lb|%))/);
  const bare = column ? t.match(new RegExp(String.raw`^${n}(?:${RANGE_SEP}${n})?$`)) : null;
  if (column === "rir" || column === "rpe") {
    if (bare) {
      const r = effortValue(column, bare[1], bare[2], bare[0]);
      if (column === "rir") out.targetRir = r.value; else out.targetRpe = r.value;
      if (r.flag) out.flags.push(r.flag);
      out.matched.push(bare[0]);
    }
    return out;
  }
  const m = at ?? bare;
  if (m) {
    const v = parseNumber(m[1]);
    if (v != null) {
      const options: FlagOption[] = [];
      if (v >= 0 && v <= 10) options.push({ label: `RIR ${v}`, patch: { targetRir: v } });
      if (v >= 1 && v <= 10) options.push({ label: `RPE ${v}`, patch: { targetRpe: v } });
      out.flags.push(flag({
        field: "effort", code: "effort_unclear", blocking: options.length > 0,
        message: options.length ? `Is “${m[0].trim()}” RIR (reps in reserve) or RPE (effort out of 10)? They are different scales.` : `“${m[0].trim()}” isn't a valid RIR or RPE.`,
        options,
      }));
      out.matched.push(m[0]);
    }
  }
  return out;
}

// ---------- load ----------
interface LoadResult {
  loadKg: number | null;
  origin: Origin | null;
  flags: Flag[];
  note: string | null;
  matched: string | null;
}

function kg(n: number, unit: "kg" | "lb") {
  return unit === "kg" ? round(n, 2) : round(n * KG_PER_LB, 2);
}

/** A prescribed load: "60 kg", "62,5kg", "135 lb", "70% 1RM", "BW", a range, or a bare number. */
export function parseLoad(text: string, unitHint?: "kg" | "lb", fromColumn = false): LoadResult {
  const t = norm(text);
  const out: LoadResult = { loadKg: null, origin: null, flags: [], note: null, matched: null };
  if (!t || /^(?:-|n\/?a|—)$/.test(t)) return out;
  if (/%/.test(t)) {
    out.note = `Load as written: ${cleanText(text)}`;
    out.flags.push(flag({ field: "load", code: "load_percent", blocking: false, message: "Percentage loads aren't converted: Forma doesn't know your 1RM. Kept in notes." }));
    out.matched = t;
    return out;
  }
  if (/\b(?:bw|bodyweight|body weight|corpo libero|peso corporeo)\b/.test(t)) {
    out.note = `Load as written: ${cleanText(text)}`;
    out.matched = t;
    return out;
  }
  const unitRe = String.raw`(kg|kgs|kilos?|chili|lb|lbs|pounds?)`;
  const range = t.match(new RegExp(String.raw`(${NUM})${RANGE_SEP}(${NUM})\s*${unitRe}${fromColumn ? "?" : ""}`));
  const single = t.match(new RegExp(String.raw`(${NUM})\s*${unitRe}${fromColumn ? "?" : ""}(?![a-z])`));
  const unitOf = (u: string | undefined) => (u ? (/^(?:lb|lbs|pounds?)$/.test(u) ? "lb" : "kg") : unitHint);
  if (range && parseNumber(range[1]) != null && parseNumber(range[2]) != null) {
    const u = unitOf(range[3]);
    const a = parseNumber(range[1])!, b = parseNumber(range[2])!;
    out.matched = range[0];
    out.note = `Load as written: ${range[0].trim()}`;
    const options: FlagOption[] = u
      ? [{ label: `${a} ${u}`, patch: { loadKg: kg(a, u) } }, { label: `${b} ${u}`, patch: { loadKg: kg(b, u) } }]
      : [];
    options.push({ label: "No load", patch: { loadKg: null } });
    out.flags.push(flag({ field: "load", code: "load_unit", blocking: true, message: `The plan gives a load range (${range[0].trim()}). Choose one target or none.`, options }));
    return out;
  }
  if (!single) {
    if (fromColumn) {
      out.note = `Load as written: ${cleanText(text)}`;
      out.flags.push(flag({ field: "load", code: "load_unparsed", blocking: false, message: "The load couldn't be read as a number. Kept in notes." }));
    }
    return out;
  }
  const n = parseNumber(single[1]);
  if (n == null) return out;
  out.matched = single[0];
  const u = unitOf(single[2]);
  if (u) {
    out.loadKg = kg(n, u);
    out.origin = u === "lb" ? "interpreted" : "extracted";
    if (/\b(?:each|per hand|per side|per lato|x ?2|2 ?x)\b/.test(t)) {
      out.flags.push(flag({ field: "load", code: "load_unparsed", blocking: false, message: "Check whether this load is per dumbbell/side or the total; Forma uses the exercise's weight entry." }));
    }
    if (out.loadKg > 1000) { out.loadKg = null; out.flags.push(flag({ field: "load", code: "load_unparsed", blocking: false, message: "Load is out of range; not imported." })); }
    return out;
  }
  out.flags.push(flag({
    field: "load", code: "load_unit", blocking: true, message: `Load “${single[1]}” has no unit. kg or lb?`,
    options: [{ label: `${n} kg`, patch: { loadKg: kg(n, "kg") } }, { label: `${n} lb`, patch: { loadKg: kg(n, "lb") } }, { label: "No load", patch: { loadKg: null } }],
  }));
  return out;
}

// ---------- tempo, sides, warm-ups, drops, supersets, unsupported ----------
export function parseTempo(text: string, fromColumn = false): { tempo: string | null; matched: string | null } {
  const t = norm(text).toUpperCase();
  const d = "[0-9X]";
  const re = fromColumn
    ? new RegExp(`^(${d})[-.\\s/]?(${d})[-.\\s/]?(${d})(?:[-.\\s/]?(${d}))?$`)
    : new RegExp(`TEMPO\\s*[:=]?\\s*(${d})[-./]?(${d})[-./]?(${d})(?:[-./]?(${d}))?`);
  const m = t.match(re);
  if (!m) return { tempo: null, matched: null };
  return { tempo: [m[1], m[2], m[3], m[4]].filter(Boolean).join("-"), matched: m[0].toLowerCase() };
}

const PER_SIDE = /\b(?:each|per|every)\s+(?:side|leg|arm|hand)\b|\/\s*(?:side|leg|arm)\b|\be\/s\b|\bea\.? side\b|\b(?:ogni|per)\s+(?:lato|gamba|braccio)\b|\bx\s*lato\b|\bpro seite\b|\bpar côté\b/;

const UNSUPPORTED: [RegExp, string][] = [
  [/rest[\s-]?pause/, "rest-pause"], [/\bmyo[\s-]?reps?\b/, "myo-reps"], [/\bcluster/, "cluster sets"],
  [/\b1(?:\.5| ?1\/2| e mezzo)\s*reps?\b|\bone and a half\b/, "1½ reps"], [/\biso(?:metric)?\b|\bhold\b|\btenuta\b/, "isometric holds"],
  [/\bpartials?\b|\bparziali\b/, "partial reps"], [/\bemom\b/, "EMOM"], [/\bcircuit\b|\bcircuito\b/, "circuits"],
  [/\bgiant set\b|\btri[\s-]?set\b/, "giant sets / tri-sets"], [/\bnegatives?\b|\beccentric only\b|\bnegative\b/, "negatives"],
  [/\bpyramid\b|\bpiramidale\b/, "pyramids"], [/\bburnouts?\b/, "burnouts"],
];

function detectWarmups(t: string): { count: number | null; mentioned: boolean; matched: string | null } {
  const m = t.match(/\+?\s*(\d+)\s*(?:x\s*)?(?:warm[\s-]?ups?(?:\s*sets?)?|wu|ramp[\s-]?up(?:\s*sets?)?|riscaldament[oi]|serie di riscaldamento|aufwärmsätze?)\b/)
    ?? t.match(/(?:warm[\s-]?ups?|wu|riscaldamento)\s*(?:sets?|serie)?\s*[:=x]\s*(\d+)\b/);
  if (m) return { count: Number(m[1]), mentioned: true, matched: m[0] };
  const mentioned = /\bwarm[\s-]?ups?\b|\bramp[\s-]?up\b|\briscaldamento\b/.test(t);
  return { count: null, mentioned, matched: null };
}

function detectDrops(t: string): { found: boolean; count: number | null; scope: "last_set" | "all_sets" | null } {
  if (!/\bdrop[\s-]?sets?\b|\bdropsets?\b|\bdrops?\b|\bds\b|\bstripping\b|\bscalare\b/.test(t)) return { found: false, count: null, scope: null };
  const n = t.match(/(\d+)\s*(?:x\s*)?drops?\b/) ?? t.match(/drops?\s*x\s*(\d+)/) ?? t.match(/(\d+)\s*(?:scalate|stripping)/);
  const count = n ? Number(n[1]) : /\bdouble drop\b|\bdoppio\b/.test(t) ? 2 : /\btriple drop\b|\btriplo\b/.test(t) ? 3 : null;
  const scope = /\blast set\b|\bfinal set\b|\bon the last\b|\bultima serie\b|\bletzte?n? satz\b/.test(t)
    ? "last_set"
    : /\ball sets\b|\bevery set\b|\beach set\b|\bogni serie\b|\btutte le serie\b/.test(t) ? "all_sets" : null;
  return { found: true, count, scope };
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FILLER = new Set([
  "sets", "set", "reps", "rep", "of", "x", "rest", "with", "and", "e", "da", "di", "serie", "rip", "ripetizioni", "each",
  "side", "per", "lato", "recupero", "riposo", "rec", "pausa", "on", "the", "last", "final", "all", "every", "drop", "drops",
  "dropset", "warm", "up", "warmup", "ups", "wu", "working", "work", "plus", "then", "min", "sec", "s", "kg", "lb", "lbs",
  "rir", "rpe", "tempo", "at", "a", "leg", "arm", "hand", "ogni", "gamba", "braccio", "double", "triple", "ds", "optional",
  "opzionale", "stripping", "ultima", "tutte", "le",
]);

/** Exercise name cleanup: list numbers, superset prefixes ("A1."), trailing separators. */
export function splitName(raw: string): { name: string; label: string | null; optional: boolean } {
  let s = cleanText(raw);
  let label: string | null = null;
  const pre = s.match(/^\s*([A-Za-z])\s*([1-9])\s*[.):\-]\s*/) ?? s.match(/^\s*([1-9])\s*([a-zA-Z])\s*[.):\-]\s+/);
  if (pre) {
    label = (/[A-Za-z]/.test(pre[1]) ? pre[1] : pre[2]).toUpperCase();
    s = s.slice(pre[0].length);
  } else {
    s = s.replace(/^\s*\d{1,2}\s*[.)\-]\s+/, "");
  }
  const optional = /\((?:optional|opzionale|facoltativo)\)|\b(?:optional|opzionale|facoltativo)\b/i.test(s);
  s = s.replace(/\((?:optional|opzionale|facoltativo)\)/gi, "").replace(/[\s:;,\-–—]+$/, "").trim();
  return { name: s.slice(0, 120), label, optional };
}

/** Interpret one source row. The caller attaches the match, ids and source reference. */
export function interpretRow(row: SourceRow): Interpretation {
  const c = row.cells;
  const values: DraftValues = { ...EMPTY_VALUES };
  const origin: Interpretation["origin"] = {};
  const flags: Flag[] = [];
  const notes: string[] = [];
  const set = <K extends keyof DraftValues>(k: K, v: DraftValues[K], o: Origin) => { values[k] = v; origin[k] = o; };

  const nameInfo = splitName(c.exercise ?? "");
  const all = norm([c.exercise, c.setsReps, c.sets, c.reps, c.rest, c.load, c.rir, c.rpe, c.effort, c.tempo, c.notes].filter(Boolean).join(" | "));
  const warmupRow = /^(?:warm[\s-]?up|riscaldamento|aufwärmen|échauffement)\b/i.test(nameInfo.name)
    && !c.sets && !c.reps && !/\d+\s*x\s*\d/.test(norm(c.setsReps ?? ""));
  if (warmupRow) {
    return { name: nameInfo.name, values, origin, flags, supersetLabel: null, warmupRow: true };
  }

  // Sets and reps
  let leftover = "";
  if (c.setsReps) {
    const r = parseSetsReps(c.setsReps);
    if (r.sets != null) set("sets", r.sets, "extracted");
    if (r.repMin != null) { set("repMin", r.repMin, "extracted"); set("repMax", r.repMax, "extracted"); }
    flags.push(...r.flags);
    if (r.note) notes.push(r.note);
    leftover += " " + r.rest;
  }
  if (c.sets) {
    const r = parseSets(c.sets);
    if (r.sets != null) set("sets", r.sets, "extracted");
    leftover += " " + r.rest;
  }
  if (c.reps) {
    const r = parseReps(c.reps);
    if (r.repMin != null) { set("repMin", r.repMin, "extracted"); set("repMax", r.repMax, "extracted"); }
    if (r.sets != null && values.sets == null) set("sets", r.sets, "extracted");
    else if (r.sets != null && r.sets !== values.sets) {
      flags.push(flag({
        field: "sets", code: "missing_sets", blocking: true,
        message: `The sets column says ${values.sets}, but the reps say ${r.sets} sets.`,
        options: [{ label: `${values.sets} sets`, patch: { sets: values.sets } }, { label: `${r.sets} sets`, patch: { sets: r.sets } }],
      }));
    }
    flags.push(...r.flags);
    if (r.note) notes.push(r.note);
    leftover += " " + r.rest;
  }
  // Free text with notation in the name cell ("Bench press 3x8").
  if (values.sets == null && values.repMin == null && !flags.some((f) => f.field === "reps")) {
    const r = parseSetsReps(c.exercise ?? "");
    if (r.sets != null || r.flags.length) {
      if (r.sets != null) set("sets", r.sets, "extracted");
      if (r.repMin != null) { set("repMin", r.repMin, "extracted"); set("repMax", r.repMax, "extracted"); }
      flags.push(...r.flags);
      if (r.note) notes.push(r.note);
    }
  }

  // Each side: still N planned sets.
  if (PER_SIDE.test(all)) {
    set("perSide", true, "interpreted");
    flags.push(flag({ field: "reps", code: "per_side", blocking: false, message: `Reps are per side. This stays ${values.sets ?? "the planned number of"} set${values.sets === 1 ? "" : "s"}, not double.` }));
  }

  // Rest
  if (c.rest) {
    const r = parseRest(c.rest, row.restUnit);
    if (r.restS != null) set("restS", r.restS, r.origin ?? "extracted");
    flags.push(...r.flags);
    if (r.restS == null && !r.flags.length && norm(c.rest)) {
      notes.push(`Rest as written: ${cleanText(c.rest)}`);
      flags.push(flag({ field: "rest", code: "unparsed", blocking: false, message: "The rest couldn't be read. Kept in notes." }));
    }
  } else {
    const m = all.match(/\b(?:rest|rec|recupero|riposo|pausa|pause|r)\s*[:=]?\s*((?:\d{1,2}:[0-5]\d)|(?:\d+\s*'\s*\d+\s*"?)|(?:\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?(?:\s*(?:seconds?|secondi|secs|sec|s|minutes?|minuti|mins|min|m|"|')(?![a-z]))?))/);
    if (m) {
      const r = parseRest(m[1], row.restUnit);
      if (r.restS != null) set("restS", r.restS, r.origin ?? "extracted");
      flags.push(...r.flags);
      leftover = leftover.replace(m[0], " ");
    }
  }

  // Effort
  const effortCells: [string | undefined, "rir" | "rpe" | "effort" | undefined][] = [[c.rir, "rir"], [c.rpe, "rpe"], [c.effort, "effort"]];
  let effortSeen = false;
  for (const [text, col] of effortCells) {
    if (!text) continue;
    const r = parseEffort(text, col);
    if (r.targetRir != null) set("targetRir", r.targetRir, "extracted");
    if (r.targetRpe != null) set("targetRpe", r.targetRpe, "extracted");
    flags.push(...r.flags);
    effortSeen = true;
  }
  if (!effortSeen) {
    const r = parseEffort([c.setsReps, c.sets, c.reps, c.exercise, c.notes].filter(Boolean).join(" "));
    if (r.targetRir != null) set("targetRir", r.targetRir, "extracted");
    if (r.targetRpe != null) set("targetRpe", r.targetRpe, "extracted");
    flags.push(...r.flags);
    for (const m of r.matched) leftover = leftover.replace(m, " ");
  }

  // Load
  if (c.load) {
    const r = parseLoad(c.load, row.loadUnit, true);
    if (r.loadKg != null) set("loadKg", r.loadKg, r.origin ?? "extracted");
    flags.push(...r.flags);
    if (r.note) notes.push(r.note);
  } else {
    const r = parseLoad([c.setsReps, c.notes].filter(Boolean).join(" "), row.loadUnit);
    if (r.loadKg != null || r.flags.length) {
      if (r.loadKg != null) set("loadKg", r.loadKg, r.origin ?? "extracted");
      flags.push(...r.flags);
      if (r.note) notes.push(r.note);
      if (r.matched) leftover = leftover.replace(r.matched, " ");
    }
  }

  // Tempo
  const tp = c.tempo ? parseTempo(c.tempo, true) : parseTempo(all);
  if (tp.tempo) { set("tempo", tp.tempo, "extracted"); if (tp.matched) leftover = leftover.replace(tp.matched, " "); }
  else if (c.tempo && norm(c.tempo)) notes.push(`Tempo as written: ${cleanText(c.tempo)}`);

  // Warm-up sets
  const wu = detectWarmups(all);
  if (wu.count != null) {
    if (wu.count <= 10) set("warmupSets", wu.count, "extracted");
    if (wu.matched) leftover = leftover.replace(wu.matched, " ");
    // "2 warm-up + 3x8" sometimes arrives as "5x8" with a warm-up note; never subtract on our own.
  } else if (wu.mentioned) {
    flags.push(flag({
      field: "warmup", code: "warmup_count", blocking: false,
      message: "Warm-up sets are mentioned without a number. Add them if you want them prescribed.",
      options: [1, 2, 3].map((n) => ({ label: `${n} warm-up set${n > 1 ? "s" : ""}`, patch: { warmupSets: n } })),
    }));
  }

  // Drop sets: a parent working set followed by drop segments. Weights are never suggested.
  const ds = detectDrops(all);
  if (ds.found) {
    if (ds.count != null && ds.count >= 1 && ds.count <= 5) set("dropSegments", ds.count, "extracted");
    if (ds.scope) set("dropScope", ds.scope, "extracted");
    if (ds.count == null) {
      flags.push(flag({
        field: "drop", code: "drop_count", blocking: true, message: "The plan mentions a drop set but not how many drops.",
        options: [1, 2, 3].map((n) => ({ label: `${n} drop${n > 1 ? "s" : ""}`, patch: { dropSegments: n } })),
      }));
    }
    if (!ds.scope) {
      flags.push(flag({
        field: "drop", code: "drop_scope", blocking: true, message: "On which sets is the drop set done?",
        options: [{ label: "Last set only", patch: { dropScope: "last_set" } }, { label: "Every set", patch: { dropScope: "all_sets" } }],
      }));
    }
  }

  // Superset
  let supersetLabel = nameInfo.label;
  if (c.order) {
    const m = norm(c.order).match(/^([a-z])\s*\d+$|^\d+\s*([a-z])$/);
    if (m) supersetLabel = (m[1] ?? m[2]).toUpperCase();
  }
  if (!supersetLabel && /\bsuper[\s-]?sets?\b|\bsuperseries?\b|\bsupers[ée]rie\b|\bss\b/.test(all)) {
    flags.push(flag({ field: "superset", code: "superset_unclear", blocking: false, message: "The plan mentions a superset. Set the group letter on each exercise in it." }));
  }

  if (nameInfo.optional) set("optional", true, "interpreted");

  // Anything else Forma can't represent stays visible.
  for (const [re, label] of UNSUPPORTED) {
    if (re.test(all)) {
      flags.push(flag({ field: "notes", code: "unsupported", blocking: false, message: `${label[0].toUpperCase()}${label.slice(1)} can't be logged as such in Forma. The instruction is kept in notes.` }));
    }
  }
  const words = norm(leftover).split(/[^a-zà-ÿ]+/).filter((w) => w.length >= 2 && !FILLER.has(w));
  const unsupportedHit = flags.some((f) => f.code === "unsupported");
  if (words.length && (c.setsReps || c.reps || c.sets)) {
    const cell = [c.setsReps, c.sets, c.reps].filter(Boolean).map((x) => cleanText(x!)).join(" · ");
    notes.push(`As written: ${cell}`);
    if (!unsupportedHit) flags.push(flag({ field: "notes", code: "unparsed", blocking: false, message: "Part of the sets/reps text wasn't understood. It's kept in notes." }));
  } else if (unsupportedHit && (c.setsReps || c.reps)) {
    notes.push(`As written: ${[c.setsReps, c.reps].filter(Boolean).map((x) => cleanText(x!)).join(" · ")}`);
  }

  if (c.notes) notes.unshift(cleanText(c.notes, { multiline: true }));
  if (notes.length) set("notes", [...new Set(notes)].join("\n").slice(0, 1000), "extracted");

  if (values.sets == null) flags.push(flag({ field: "sets", code: "missing_sets", blocking: true, message: "Number of sets is missing." }));
  else if (values.sets < 1 || values.sets > 20) flags.push(flag({ field: "sets", code: "missing_sets", blocking: true, message: `${values.sets} sets is outside 1–20.` }));
  if (values.repMin == null && !flags.some((f) => f.field === "reps" && f.blocking)) {
    flags.push(flag({ field: "reps", code: "missing_reps", blocking: true, message: "Reps are missing." }));
  }

  return { name: nameInfo.name, values, origin, flags, supersetLabel, warmupRow: false };
}
