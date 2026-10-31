// Turning a source into a grid of cells: pasted tables (tabs, pipes, semicolons, commas), CSV and XLSX.
// Pure apart from readXlsx(), which needs DecompressionStream (browsers, Node 18+). Cell text is untrusted
// and is only ever cleaned and shown as text.
import { parseCsv } from "@/lib/catalog/import";
import { cleanText } from "@/lib/catalog/names";

export type Grid = string[][];

/** Split delimited text, honouring quotes. `parseCsv` handles commas; other delimiters are swapped in. */
export function parseDelimited(text: string, delimiter: string): Grid {
  if (delimiter === ",") return parseCsv(text);
  const rows: Grid = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function markdownTable(lines: string[]): Grid {
  return lines
    .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)) // separator row
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|"));
}

/**
 * Decide whether pasted text is a table and split it. Tabs (copied from a spreadsheet) win, then
 * Markdown pipes, then semicolons (European CSV, where commas are decimals), then commas. Returns
 * null for free text, which is read line by line instead.
 */
export function detectTable(text: string): { grid: Grid; delimiter: string } | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  const share = (re: RegExp, min: number) => lines.filter((l) => (l.match(re) ?? []).length >= min).length / lines.length;
  if (share(/\t/g, 1) >= 0.5) return { grid: normaliseGrid(parseDelimited(text, "\t")), delimiter: "\t" };
  if (share(/\|/g, 2) >= 0.5) return { grid: normaliseGrid(markdownTable(lines)), delimiter: "|" };
  if (share(/;/g, 1) >= 0.6) return { grid: normaliseGrid(parseDelimited(text, ";")), delimiter: ";" };
  // Commas are also ordinary punctuation, so a comma table needs a consistent column count.
  const counts = lines.map((l) => (l.match(/,/g) ?? []).length);
  const mode = counts.sort((a, b) => counts.filter((c) => c === b).length - counts.filter((c) => c === a).length)[0];
  if (mode >= 2 && lines.filter((l) => (l.match(/,/g) ?? []).length === mode).length / lines.length >= 0.6) {
    return { grid: normaliseGrid(parseCsv(text)), delimiter: "," };
  }
  return null;
}

/** Trim and clean every cell, drop fully empty trailing columns. Empty rows are kept (they separate days). */
export function normaliseGrid(grid: Grid): Grid {
  const rows = grid.map((r) => r.map((c) => cleanText(c ?? "")));
  let width = 0;
  for (const r of rows) for (let i = r.length - 1; i >= 0; i--) if (r[i]) { width = Math.max(width, i + 1); break; }
  return rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

/** "B4"-style label for a cell. */
export function cellLabel(row: number, col: number): string {
  let c = "";
  let n = col + 1;
  while (n > 0) { const m = (n - 1) % 26; c = String.fromCharCode(65 + m) + c; n = Math.floor((n - 1) / 26); }
  return `${c}${row + 1}`;
}

// ---------- XLSX ----------
// An .xlsx file is a zip of XML parts. Only what a workout table needs is read: sheet names, shared
// strings, inline strings, numbers and merged ranges (filled down, as a merged "Day 1" cell means every
// row it covers). Formulas use their cached value. Macros, external links and scripts are never read.

interface ZipEntry { name: string; method: number; compressedSize: number; offset: number }

function readZipDirectory(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This isn't a valid .xlsx file.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("This .xlsx file is damaged.");
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    entries.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const MAX_PART_BYTES = 8 * 1024 * 1024;

async function readZipEntry(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const p = e.offset;
  if (dv.getUint32(p, true) !== 0x04034b50) throw new Error("This .xlsx file is damaged.");
  const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error("This .xlsx file uses an unsupported compression.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) { await reader.cancel(); throw new Error("This spreadsheet is too large to import."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return new TextDecoder().decode(out);
}

function xmlText(s: string): string {
  return s
    .replace(/<rPh\b[\s\S]*?<\/rPh>/g, "") // phonetic runs
    .replace(/<t\b[^>]*\/>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function colIndex(ref: string): { row: number; col: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { row: -1, col: -1 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

/** Number as shown in a cell: avoids float noise like 62.50000000001 and keeps it in "." notation. */
function numText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return String(Math.round(n * 1e6) / 1e6);
}

export async function readXlsx(bytes: ArrayBuffer | Uint8Array): Promise<{ name: string; rows: Grid }[]> {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = readZipDirectory(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const part = async (n: string) => { const e = byName.get(n); return e ? readZipEntry(buf, e) : null; };

  const workbook = await part("xl/workbook.xml");
  if (!workbook) throw new Error("This isn't a valid .xlsx file.");
  const rels = (await part("xl/_rels/workbook.xml.rels")) ?? "";
  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]+)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relTarget.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const shared: string[] = [];
  const sst = await part("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(xmlText(m[1]));

  const sheets: { name: string; rows: Grid }[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = xmlText(m[1].match(/\bname="([^"]*)"/)?.[1] ?? `Sheet ${sheets.length + 1}`);
    if (/\bstate="(?:hidden|veryHidden)"/.test(m[1])) continue;
    const rid = m[1].match(/\br:id="([^"]+)"/)?.[1] ?? m[1].match(/\bid="([^"]+)"/)?.[1];
    const target = rid ? relTarget.get(rid) : undefined;
    const xml = target ? await part(`xl/${target}`) : null;
    if (!xml) continue;
    const grid: Grid = [];
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const { row, col } = colIndex(ref);
      if (row < 0 || row >= 5000 || col >= 100) continue;
      const type = c[1].match(/\bt="([^"]+)"/)?.[1];
      const body = c[2] ?? "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = "";
      if (type === "s" && v != null) text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = xmlText(body.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (type === "str" || type === "e") text = v != null ? xmlText(v) : "";
      else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
      else if (v != null) text = numText(xmlText(v));
      (grid[row] ??= [])[col] = text;
    }
    // Vertically merged cells ("Day 1" beside several rows) are filled down their first column.
    // Horizontal merges (titles across a table) stay in their first cell.
    for (const mc of xml.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const a = colIndex(mc[1]), b = colIndex(mc[2]);
      const value = grid[a.row]?.[a.col] ?? "";
      if (!value || b.row - a.row > 500) continue;
      for (let r = a.row + 1; r <= b.row; r++) (grid[r] ??= [])[a.col] = value;
    }
    const rows = Array.from({ length: grid.length }, (_, i) => Array.from(grid[i] ?? [], (x) => x ?? ""));
    sheets.push({ name: cleanText(name).slice(0, 60), rows: normaliseGrid(rows) });
  }
  if (sheets.length === 0) throw new Error("No readable sheets in this file.");
  return sheets;
}
