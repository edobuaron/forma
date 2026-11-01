// Reading running prescriptions in a trainer's plan: "Easy run 30 min", "Run 5 km", "Treadmill 20'",
// "6×400 m, rec 90 s", "8 x 1 min / 1 min jog". Pure; no I/O.
//
// Rules (same spirit as notation.ts):
//  * A row is a run only when its name says so (run, jog, treadmill, intervals, ripetute, corsa…). Walking
//    and lifting rows are never turned into runs.
//  * Minutes and kilometres are never guessed: a bare number ("Run 30") is a question.
//  * Forma plans one target per run. A range ("30–40 min") or both a time and a distance ("5 km in 30 min")
//    is a question; nothing is averaged.
//  * Pace, heart-rate, zone, speed and incline targets can't be planned in Forma: they stay in notes and
//    are flagged, never dropped.
import { cleanText } from "@/lib/catalog/names";
import { M_PER_MI, type RunSetting, type RunTargetKind } from "@/lib/domain/running";
import { norm } from "./notation";
import type { Flag } from "./types";

/** A run in an import draft (stored on the draft row; becomes a template run). Seconds and metres. */
export interface DraftRun {
  name: string;
  setting: RunSetting | null;
  target_kind: RunTargetKind;
  target_duration_s: number | null;
  target_distance_m: number | null;
  interval_count: number | null;
  interval_work_s: number | null;
  interval_work_m: number | null;
  interval_recovery_s: number | null;
}

export const EMPTY_RUN: DraftRun = {
  name: "Run", setting: null, target_kind: "open", target_duration_s: null, target_distance_m: null,
  interval_count: null, interval_work_s: null, interval_work_m: null, interval_recovery_s: null,
};

export interface RunReading {
  run: DraftRun;
  flags: Flag[];
  notes: string[];
}

const RUN_NAME = /\b(?:run|runs|running|jog|jogging|treadmill|tapis\s*roulant|intervals?|interval\s*run|fartlek|sprints?|strides|ripetute|corsa|corsetta|correre|laufen|dauerlauf|carrera|trotar)\b|\b\d+\s*k\s*run\b/;
const NOT_RUN = /\b(?:walk|walking|camminata|incline\s*walk|bike|cycling|cyclette|row(?:er|ing)?\s*machine|elliptical|ellittica|swim|stair|lunge|carry|press|curl|squat)\b/;

let seq = 0;
const flag = (f: Omit<Flag, "id">): Flag => ({ id: `run${++seq}`, ...f });

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const num = (s: string) => Number(s.replace(",", "."));

/** Whether a row's exercise name reads as running. */
export function isRunName(name: string): boolean {
  const t = norm(name);
  return RUN_NAME.test(t) && !NOT_RUN.test(t);
}

type Amount = { kind: "time"; s: number } | { kind: "distance"; m: number };

/** "400 m", "5 km", "5k", "3 mi", "2 miles" → metres; "20 min", "20'", "45 s", "90\"", "1 h", "3:00", "1:05:00" → seconds. */
function amount(value: string, unit: string | undefined): Amount | null {
  const v = num(value);
  const u = (unit ?? "").trim();
  if (/^(?:km|k|kms|chilometri)$/.test(u)) return { kind: "distance", m: v * 1000 };
  if (/^(?:m|mt|metri|meters?|metres?)$/.test(u)) return { kind: "distance", m: v };
  if (/^(?:mi|mile|miles)$/.test(u)) return { kind: "distance", m: Math.round(v * M_PER_MI * 10) / 10 };
  if (/^(?:min|mins|minutes?|minuti|minuto|')$/.test(u)) return { kind: "time", s: Math.round(v * 60) };
  if (/^(?:s|sec|secs|seconds?|secondi|"|'')$/.test(u)) return { kind: "time", s: Math.round(v) };
  if (/^(?:h|hr|hrs|hours?|ore|ora)$/.test(u)) return { kind: "time", s: Math.round(v * 3600) };
  return null;
}

function clock(t: string): number | null {
  const m = t.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return null;
  return m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
}

const UNIT = String.raw`(km|kms|k|mi|miles?|m|mt|metri|meters?|metres?|min|mins|minutes?|minuti|minuto|h|hr|hrs|hours?|s|sec|secs|seconds?|secondi|''|'|")`;
const AMOUNT_RE = new RegExp(String.raw`(\d{1,2}:[0-5]\d(?::[0-5]\d)?)|(${NUM})\s*${UNIT}(?![a-z])`, "g");

function amountsIn(t: string): { a: Amount; index: number; text: string }[] {
  const out: { a: Amount; index: number; text: string }[] = [];
  for (const m of t.matchAll(AMOUNT_RE)) {
    const a = m[1] ? (clock(m[1]) != null ? { kind: "time" as const, s: clock(m[1])! } : null) : amount(m[2], m[3]);
    if (a) out.push({ a, index: m.index!, text: m[0] });
  }
  return out;
}

const fmtAmount = (a: Amount) => (a.kind === "time" ? (a.s % 60 === 0 ? `${a.s / 60} min` : `${a.s} s`) : a.m >= 1000 ? `${a.m / 1000} km` : `${a.m} m`);

/**
 * Read a running row. `name` is the exercise cell; `text` the prescription cells (sets/reps/notes);
 * `rest` the rest cell, read as interval recovery. Returns null when the row isn't a run.
 */
export function readRun(name: string, text: string, rest?: string, force = false): RunReading | null {
  if (!force && !isRunName(name)) return null;
  const all = norm([name, text, rest].filter(Boolean).join(" | "));
  // The name without the target, which is read into its own fields ("Easy run 30 min" → "Easy run").
  const shortName = cleanText(name).replace(/@.*$/, "").replace(/\b\d+(?:[.,]\d+)?\s*(?:-|to)?\s*\d*(?:[.,]\d+)?\s*(?:km|k|mi|miles?|m|min|mins|minutes?|minuti|'|h|s|sec)?(?:\s*x\s*\S+)?(?![a-z])/gi, " ")
    .replace(/\s+/g, " ").replace(/[\s:;,\-–—]+$/, "").trim();
  const run: DraftRun = { ...EMPTY_RUN, name: (/[a-zà-ÿ]/i.test(shortName) ? shortName : cleanText(name)).slice(0, 120) || "Run" };
  const flags: Flag[] = [];
  const notes: string[] = [];

  if (/\btreadmill\b|\btapis\s*roulant\b/.test(all)) run.setting = "treadmill";
  else if (/\b(?:outdoors?|outside|track|pista|road|trail|parco|park)\b/.test(all)) run.setting = "outdoor";

  // Things Forma doesn't plan for a run stay visible.
  const unsupported: string[] = [];
  if (/\d:\d\d\s*\/\s*(?:km|mi)|\/\s*km\b|\bpace\b|\bpasso\b|\britmo\b/.test(all)) unsupported.push("pace");
  if (/\bhr\b|\bheart\s*rate\b|\bbpm\b|\bfc\b|\bfrequenza\b|\bzone\s*\d|\bz\d\b|\bzona\s*\d/.test(all)) unsupported.push("heart rate / zone");
  if (/\bkm\s*\/\s*h\b|\bkph\b|\bmph\b|\bspeed\b|\bvelocit/.test(all)) unsupported.push("speed");
  if (/\bincline\b|\bpendenza\b|\binclinazione\b|\d+\s*%/.test(all)) unsupported.push("incline");
  if (unsupported.length) {
    notes.push(`As written: ${cleanText([name, text, rest].filter(Boolean).join(" · "))}`);
    flags.push(flag({ field: "notes", code: "unsupported", blocking: false, message: `${unsupported.join(", ").replace(/^./, (c) => c.toUpperCase())} targets can't be planned for a run in Forma. Kept in notes.` }));
  }

  // Remove pace/speed figures before reading amounts, so "5:30/km" isn't read as a time.
  const body = norm([name, text].filter(Boolean).join(" "))
    .replace(/\d{1,2}:[0-5]\d\s*\/\s*(?:km|mi)\b/g, " ").replace(new RegExp(`${NUM}\\s*(?:km\\s*/\\s*h|kph|mph)`, "g"), " ")
    .replace(/\d+\s*%/g, " ").replace(/\b\d+\s*k\s*run\b/, (m) => m.replace(/\s*run$/, ""));
  // "30m" is minutes in some plans and metres in others; under 100 it's asked, never guessed.
  const shortM = body.match(/(?:^|[^\d.,:])(\d{1,2})\s*m(?![a-z])/);
  if (shortM && !/\d\s*x\s*\d{1,2}\s*m(?![a-z])/.test(body)) {
    const v = Number(shortM[1]);
    flags.push(flag({
      field: "row", code: "run_unit", blocking: true, message: `“${shortM[0].trim()}”: minutes or metres?`,
      options: [
        { label: `${v} min`, patch: {}, runPatch: { target_kind: "time", target_duration_s: v * 60 } },
        { label: `${v} m`, patch: {}, runPatch: { target_kind: "distance", target_distance_m: v } },
      ],
    }));
    return { run, flags, notes };
  }

  // Intervals: "6 x 400 m", "8x1 min", "5 × 3:00".
  const iv = body.match(new RegExp(String.raw`(\d{1,2})\s*x\s*(?:(\d{1,2}:[0-5]\d)|(${NUM})\s*${UNIT}(?![a-z]))`));
  if (iv) {
    const count = Number(iv[1]);
    const work = iv[2] ? { kind: "time" as const, s: clock(iv[2])! } : amount(iv[3], iv[4]);
    run.target_kind = "intervals";
    run.interval_count = count >= 1 && count <= 50 ? count : null;
    if (run.interval_count == null) flags.push(flag({ field: "row", code: "run_unclear", blocking: true, message: `${count} repeats is outside 1–50.` }));
    if (work?.kind === "time") run.interval_work_s = work.s;
    else if (work) run.interval_work_m = work.m;
    // Recovery: the rest cell, or a time after the interval ("rec 90 s", "/ 1 min", "(2 min jog)").
    const after = body.slice(iv.index! + iv[0].length) + " " + norm(rest ?? "");
    const recAmounts = amountsIn(after);
    const rec = recAmounts[0];
    if (rec?.a.kind === "time") run.interval_recovery_s = rec.a.s;
    else if (rec?.a.kind === "distance") {
      notes.push(`Recovery as written: ${rec.text.trim()}`);
      flags.push(flag({ field: "rest", code: "run_recovery_distance", blocking: false, message: `Recovery is given as a distance (${rec.text.trim()}). Forma plans recovery as a time; it's kept in notes.` }));
    } else if (rest && norm(rest)) {
      const n = norm(rest).match(/^(\d+(?:[.,]\d+)?)$/);
      if (n) {
        const v = num(n[1]);
        flags.push(flag({
          field: "rest", code: "rest_unit", blocking: true, message: `Recovery “${n[1]}” has no unit. Seconds or minutes?`,
          options: [{ label: `${v} seconds`, patch: {}, runPatch: { interval_recovery_s: Math.round(v) } }, { label: `${v} min`, patch: {}, runPatch: { interval_recovery_s: Math.round(v * 60) } }],
        }));
      }
    } else {
      flags.push(flag({ field: "rest", code: "run_no_recovery", blocking: false, message: "No recovery between intervals is given. Add one if the plan expects it." }));
    }
    return { run, flags, notes };
  }

  // Ranges: "30-40 min", "5-8 km".
  const range = body.match(new RegExp(String.raw`(${NUM})\s*(?:-|to|a)\s*(${NUM})\s*${UNIT}(?![a-z])`));
  if (range) {
    const lo = amount(range[1], range[3]), hi = amount(range[2], range[3]);
    if (lo && hi) {
      const patch = (a: Amount) => (a.kind === "time" ? { target_kind: "time" as const, target_duration_s: a.s } : { target_kind: "distance" as const, target_distance_m: a.m });
      flags.push(flag({
        field: "row", code: "run_range", blocking: true, message: `The plan gives a range (${range[0].trim()}). Forma plans one target per run.`,
        options: [{ label: fmtAmount(lo), patch: {}, runPatch: patch(lo) }, { label: fmtAmount(hi), patch: {}, runPatch: patch(hi) }, { label: "No target", patch: {}, runPatch: { target_kind: "open" } }],
      }));
      return { run, flags, notes };
    }
  }

  const found = amountsIn(body);
  const time = found.find((f) => f.a.kind === "time");
  const dist = found.find((f) => f.a.kind === "distance");
  if (time && dist) {
    notes.push(`As written: ${cleanText([name, text].filter(Boolean).join(" · "))}`);
    flags.push(flag({
      field: "row", code: "run_two_targets", blocking: true,
      message: `The plan gives both a distance and a time (${dist.text.trim()}, ${time.text.trim()}). Forma plans one target per run; the other stays in notes.`,
      options: [
        { label: `Distance ${fmtAmount(dist.a)}`, patch: {}, runPatch: { target_kind: "distance", target_distance_m: (dist.a as { m: number }).m } },
        { label: `Time ${fmtAmount(time.a)}`, patch: {}, runPatch: { target_kind: "time", target_duration_s: (time.a as { s: number }).s } },
      ],
    }));
    return { run, flags, notes };
  }
  if (time) { run.target_kind = "time"; run.target_duration_s = (time.a as { s: number }).s; return { run, flags, notes }; }
  if (dist) { run.target_kind = "distance"; run.target_distance_m = (dist.a as { m: number }).m; return { run, flags, notes }; }

  // A bare number ("Run 30", "Corsa: 5") is minutes or kilometres: ask.
  const bare = body.replace(/\b(?:run|running|jog|corsa|treadmill)\b/g, " ").match(/(?:^|\s)(\d+(?:[.,]\d+)?)(?:\s|$)/);
  if (bare) {
    const v = num(bare[1]);
    flags.push(flag({
      field: "row", code: "run_unit", blocking: true, message: `“${bare[1]}” has no unit. Minutes or kilometres?`,
      options: [
        { label: `${v} min`, patch: {}, runPatch: { target_kind: "time", target_duration_s: Math.round(v * 60) } },
        { label: `${v} km`, patch: {}, runPatch: { target_kind: "distance", target_distance_m: v * 1000 } },
        { label: `${v} miles`, patch: {}, runPatch: { target_kind: "distance", target_distance_m: Math.round(v * M_PER_MI * 10) / 10 } },
      ],
    }));
  }
  return { run, flags, notes };
}
