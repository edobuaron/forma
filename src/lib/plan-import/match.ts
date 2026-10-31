// Matching a plan's exercise names to the user's library and the built-in catalog. Pure.
//
// Only an exact name or alias match is used without asking. A match found by expanding an abbreviation
// ("DB" → dumbbell) is proposed and needs the user's confirmation; anything merely similar is offered as
// a candidate and never chosen. Equipment words are significant: "Dumbbell bench press" never matches
// "Barbell bench press" on its own.
import type { CatalogExercise } from "@/lib/catalog/catalog";
import { nameKey } from "@/lib/catalog/names";
import type { ExerciseChoice, ExerciseMatch, MatchCandidate } from "./types";

export interface LibraryEntry {
  id: string;
  name: string;
  aliases: string[];
  archived: boolean;
  catalogSlug: string | null;
}

// Whole-word abbreviations and common non-English gym names, expanded before comparing.
// General gym vocabulary only; nothing here is specific to one person's plan.
const PHRASES: [RegExp, string][] = [
  [/\bpanca piana\b/g, "bench press"], [/\bpanca inclinata\b/g, "incline bench press"], [/\bpanca declinata\b/g, "decline bench press"],
  [/\bstacco rumeno\b/g, "romanian deadlift"], [/\bstacco da terra\b|\bstacchi\b|\bstacco\b/g, "deadlift"],
  [/\blento avanti\b/g, "overhead press"], [/\balzate laterali\b/g, "lateral raise"], [/\balzate posteriori\b/g, "rear delt fly"],
  [/\brematore\b/g, "row"], [/\btrazioni\b/g, "pull up"], [/\baffondi\b/g, "lunge"], [/\bpressa\b/g, "leg press"],
  [/\bcroci\b/g, "fly"], [/\blat machine\b/g, "lat pulldown"], [/\bpolpacci\b/g, "calf raise"], [/\bmanubri\b|\bmanubrio\b/g, "dumbbell"],
  [/\bbilanciere\b/g, "barbell"], [/\bcavi\b|\bcavo\b/g, "cable"], [/\bspinte\b/g, "press"],
  [/\blat pd\b/g, "lat pulldown"], [/\bcgbp\b/g, "close grip bench press"], [/\bohp\b/g, "overhead press"],
  [/\brdls?\b/g, "romanian deadlift"], [/\bsldl\b/g, "stiff leg deadlift"], [/\bbss\b/g, "bulgarian split squat"],
  [/\bdbs?\b/g, "dumbbell"], [/\bbb\b/g, "barbell"], [/\bkb\b/g, "kettlebell"], [/\bsm\b/g, "smith"],
  [/\binc\b|\bincl\b/g, "incline"], [/\bdec\b/g, "decline"], [/\bext\b/g, "extension"], [/\bpd\b/g, "pulldown"],
  [/\bsa\b/g, "single arm"], [/\bsl\b/g, "single leg"], [/\bbw\b/g, "bodyweight"], [/\bpullups?\b/g, "pull up"],
  [/\bchinups?\b/g, "chin up"], [/\bpushups?\b/g, "push up"], [/\bsitups?\b/g, "sit up"],
];

export function expandName(name: string): string {
  let s = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  return new Set(
    expandName(s).split(" ").filter(Boolean)
      .map((w) => (w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

interface Target { choice: ExerciseChoice; names: string[]; archived: boolean }

function targets(library: LibraryEntry[], catalog: readonly CatalogExercise[]): Target[] {
  const inLibrary = new Set(library.map((l) => l.catalogSlug).filter(Boolean));
  const libKeys = new Set(library.flatMap((l) => [l.name, ...l.aliases].map(nameKey)));
  return [
    ...library.map((l) => ({ choice: { kind: "library" as const, id: l.id, name: l.name }, names: [l.name, ...l.aliases], archived: l.archived })),
    // A catalog entry the library already has (by link or by name) is offered as the library exercise only.
    ...catalog
      .filter((c) => !inLibrary.has(c.slug) && ![c.name, ...c.aliases].some((n) => libKeys.has(nameKey(n))))
      .map((c) => ({ choice: { kind: "catalog" as const, slug: c.slug, name: c.name }, names: [c.name, ...c.aliases], archived: false })),
  ];
}

function sameWords(a: Set<string>, b: Set<string>): boolean {
  return a.size > 0 && a.size === b.size && [...a].every((w) => b.has(w));
}

function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/** Candidates for one name, best first. `suggestion` is an optional expanded name from an AI reader. */
export function matchExercise(name: string, library: LibraryEntry[], catalog: readonly CatalogExercise[], suggestion?: string): ExerciseMatch {
  const all = targets(library, catalog);
  const key = nameKey(name);
  const expanded = [expandName(name), suggestion ? expandName(suggestion) : null].filter(Boolean).map((s) => nameKey(s!));
  const exact: Target[] = [];
  const viaExpansion: Target[] = [];
  const similar: { t: Target; score: number }[] = [];
  const nameTokens = tokens(suggestion ? `${name} ${suggestion}` : name);
  const wordSets = [tokens(name), ...(suggestion ? [tokens(suggestion)] : [])];
  for (const t of all) {
    if (key && t.names.some((n) => nameKey(n) === key)) { exact.push(t); continue; }
    // Same words after expanding abbreviations, in any order ("DB incline press" = "Incline dumbbell press").
    if (t.names.some((n) => expanded.includes(nameKey(expandName(n))) || wordSets.some((w) => sameWords(w, tokens(n))))) { viaExpansion.push(t); continue; }
    const score = Math.max(...t.names.map((n) => similarity(nameTokens, tokens(n))));
    if (score >= 0.34) similar.push({ t, score });
  }
  similar.sort((a, b) => b.score - a.score);
  const rank = (ts: Target[]) => [...ts].sort((a, b) => Number(a.archived) - Number(b.archived) || (a.choice.kind === "library" ? -1 : 1));
  const candidates: MatchCandidate[] = [
    ...rank(exact).map((t) => ({ choice: t.choice, quality: "exact" as const })),
    ...rank(viaExpansion).map((t) => ({ choice: t.choice, quality: "expanded" as const })),
    ...similar.slice(0, 5).map(({ t }) => ({ choice: t.choice, quality: "similar" as const })),
  ].slice(0, 6);

  const activeExact = exact.filter((t) => !t.archived);
  if (activeExact.length === 1 || (activeExact.length > 1 && activeExact.filter((t) => t.choice.kind === "library").length === 1)) {
    const pick = activeExact.find((t) => t.choice.kind === "library") ?? activeExact[0];
    return { status: "confirmed", choice: pick.choice, candidates };
  }
  if (exact.length || viaExpansion.length) {
    return { status: "proposed", choice: rank([...exact, ...viaExpansion])[0].choice, candidates };
  }
  return { status: "none", choice: null, candidates };
}
