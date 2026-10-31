"use client";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, ClipboardPaste, FileUp, Loader2, Plus, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ExerciseForm } from "@/components/exercises/exercise-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { CATALOG } from "@/lib/catalog/catalog";
import { nameKey } from "@/lib/catalog/names";
import { createProgramFromImport, deleteDraft, saveDraft, type StoredDraft } from "@/lib/data/plan-import";
import type { ExerciseRow } from "@/lib/data/types";
import type { WeightUnit } from "@/lib/domain/types";
import { DOCUMENT_TYPES, documentProblem, transcriptionToRows, TranscriptionSchema } from "@/lib/plan-import/document";
import { buildDraft, rowToExercise } from "@/lib/plan-import/extract";
import { readXlsx } from "@/lib/plan-import/grid";
import type { LibraryEntry } from "@/lib/plan-import/match";
import { fmtRest } from "@/lib/plan-import/notation";
import { applyOptionEverywhere, chooseExercise, draftProblems, mapExercises, summarise, toPayload } from "@/lib/plan-import/review";
import { draftFromGrid, draftFromText, emptyDraft, gridSourceFor, MAPPABLE_FIELDS, remap } from "@/lib/plan-import/source";
import { FIELD_LABELS, MAX_TEXT_BYTES, MAX_XLSX_BYTES, type DraftExercise, type Flag, type PlanDraft, type PlanField } from "@/lib/plan-import/types";
import { createClient } from "@/lib/supabase/client";
import { cn, uuid } from "@/lib/utils";
import { ExerciseRowEditor } from "./exercise-row";

const LOCAL_KEY = "forma.planImport.draft";

function toLibrary(rows: ExerciseRow[]): LibraryEntry[] {
  return rows.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases ?? [], archived: !!e.archived_at, catalogSlug: e.catalog_slug }));
}

type Step = "source" | "review" | "summary" | "done";

export function ImportPlan({ library: initialLibrary, drafts, unit, defaultRestS, hasActiveProgram, documentsEnabled }: {
  library: ExerciseRow[];
  drafts: StoredDraft[];
  unit: WeightUnit;
  defaultRestS: number;
  hasActiveProgram: boolean;
  documentsEnabled: boolean;
}) {
  const router = useRouter();
  const [library, setLibrary] = useState(initialLibrary);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [step, setStep] = useState<Step>("source");
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "local">("idle");
  const [picker, setPicker] = useState<{ workoutId: string; exId: string } | null>(null);
  const [creating, setCreating] = useState<{ workoutId: string; exId: string; name: string } | null>(null);
  const [makeActive, setMakeActive] = useState(!hasActiveProgram);
  const [created, setCreated] = useState<{ programId: string; status: string } | null>(null);
  const [pendingDoc, setPendingDoc] = useState<File | null>(null);
  const [savedDrafts, setSavedDrafts] = useState(drafts);
  const creatingRef = useRef(false);

  const ctx = useMemo(() => ({ library: toLibrary(library.filter((e) => !e.archived_at).concat(library.filter((e) => e.archived_at))), catalog: CATALOG, newId: uuid }), [library]);

  // Offer a draft left on this device if the server copy didn't save (offline, closed tab).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return;
      const local = JSON.parse(raw) as PlanDraft;
      if (local?.version === 1 && !drafts.some((d) => d.id === local.importId)) {
        setSavedDrafts((cur) => [{ id: local.importId, source_kind: local.sourceKind, source_name: local.sourceName, draft: local, updated_at: new Date().toISOString(), expires_at: "" }, ...cur]);
      }
    } catch { /* storage unavailable */ }
  }, [drafts]);

  // Autosave: server first, this device as a fallback. The draft survives failed reads and validation.
  useEffect(() => {
    if (!draft || step === "done") return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(draft)); } catch { /* storage unavailable */ }
      try { await saveDraft(createClient(), draft); setSaveState("saved"); } catch { setSaveState("local"); }
    }, 700);
    return () => clearTimeout(t);
  }, [draft, step]);

  function start(d: PlanDraft) {
    setDraft(d);
    setStep("review");
    if (d.workouts.every((w) => w.exercises.length === 0) && d.sourceKind !== "manual") {
      toast.error("No exercises were found. Check the column mapping, or add them by hand.");
    }
  }

  function readText(src: string, kind: "paste" | "csv", name: string | null) {
    if (new Blob([src]).size > MAX_TEXT_BYTES) return toast.error(`That's more than ${MAX_TEXT_BYTES / 1024} KB of text.`);
    if (!src.trim()) return toast.error("Paste the plan first.");
    start(draftFromText(uuid(), kind, name, src, ctx));
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    const name = f.name.slice(0, 200);
    const ext = name.toLowerCase().split(".").pop() ?? "";
    try {
      if (["csv", "tsv", "txt"].includes(ext) || f.type.startsWith("text/")) {
        if (f.size > MAX_TEXT_BYTES) return toast.error(`Text files can be up to ${MAX_TEXT_BYTES / 1024} KB.`);
        return readText(await f.text(), "csv", name);
      }
      if (ext === "xlsx") {
        if (f.size > MAX_XLSX_BYTES) return toast.error(`Spreadsheets can be up to ${MAX_XLSX_BYTES / 1024 / 1024} MB.`);
        setBusy(true);
        const sheets = await readXlsx(await f.arrayBuffer());
        return start(draftFromGrid(uuid(), "xlsx", name, gridSourceFor(sheets), ctx));
      }
      if (ext === "xls" || ext === "numbers" || ext === "ods") return toast.error("Save the spreadsheet as .xlsx or .csv first.");
      if (!documentsEnabled) {
        return toast.error("PDFs and photos can't be imported yet. Copy the table into Paste, save it as CSV or Excel (.xlsx), or enter the plan by hand.");
      }
      const problem = documentProblem(f.type, f.size);
      if (problem) return toast.error(problem);
      setPendingDoc(f); // PDFs and photos need explicit consent before anything is sent.
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendDocument(f: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch("/api/plan-import/extract", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message ?? "The document couldn't be read.");
      const parsed = TranscriptionSchema.safeParse(json.transcription);
      if (!parsed.success) throw new Error("The reply from the reading service wasn't valid. Nothing was imported.");
      const kind = f.type === "application/pdf" ? "pdf" : "image";
      setPendingDoc(null);
      start(buildDraft({ importId: uuid(), sourceKind: kind, sourceName: f.name.slice(0, 200), ...transcriptionToRows(parsed.data) }, ctx));
    } catch (e) {
      toast.error(`${(e as Error).message} You can paste the table or enter it by hand instead.`);
    } finally {
      setBusy(false);
    }
  }

  const update = (fn: (d: PlanDraft) => PlanDraft) => setDraft((d) => (d ? fn(d) : d));
  const updateEx = (wid: string, eid: string, next: DraftExercise) =>
    update((d) => ({ ...d, workouts: d.workouts.map((w) => (w.id === wid ? { ...w, exercises: w.exercises.map((e) => (e.id === eid ? next : e)) } : w)) }));

  /** A choice made for one row also answers rows with the same name that aren't confirmed yet. */
  function choose(wid: string, eid: string, row: ExerciseRow) {
    const choice = { kind: "library" as const, id: row.id, name: row.name };
    update((d) => {
      const target = d.workouts.find((w) => w.id === wid)?.exercises.find((e) => e.id === eid);
      const key = target ? nameKey(target.name) : "";
      return mapExercises(d, (e) => (e.id === eid || (key && nameKey(e.name) === key && e.match.status !== "confirmed") ? chooseExercise(e, choice) : e));
    });
  }

  async function create() {
    if (!draft || creatingRef.current) return; // a double tap sends nothing twice
    creatingRef.current = true;
    setBusy(true);
    try {
      // Retried with the same import id, so a lost response can't create a second program.
      let r: Awaited<ReturnType<typeof createProgramFromImport>> | null = null;
      for (let attempt = 1; ; attempt++) {
        try { r = await createProgramFromImport(createClient(), draft.importId, toPayload(draft, defaultRestS), makeActive); break; }
        catch (e) { if (attempt >= 2 || !/fetch|network/i.test((e as Error).message)) throw e; }
      }
      setCreated({ programId: r.program_id, status: r.status });
      setStep("done");
      try { localStorage.removeItem(LOCAL_KEY); } catch { /* storage unavailable */ }
      router.refresh();
    } catch (e) {
      toast.error(`The program wasn't created: ${(e as Error).message} Your draft is kept.`);
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  }

  async function discard(id: string) {
    if (!confirm("Delete this draft? The plan you imported won't be kept.")) return;
    try { await deleteDraft(createClient(), id); } catch { /* not on the server yet */ }
    try { const raw = localStorage.getItem(LOCAL_KEY); if (raw && (JSON.parse(raw) as PlanDraft).importId === id) localStorage.removeItem(LOCAL_KEY); } catch { /* storage unavailable */ }
    setSavedDrafts((cur) => cur.filter((d) => d.id !== id));
    if (draft?.importId === id) { setDraft(null); setStep("source"); }
  }

  // ---------- done ----------
  if (step === "done" && created) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-5">
        <p className="flex items-center gap-2 text-[16px] font-semibold"><CheckCircle2 className="size-5 text-positive" />
          {created.status === "already_created" ? "This plan was already imported" : "Program created"}
        </p>
        <p className="text-[13.5px] text-muted-foreground">
          {makeActive ? "It's now your active program." : "Your active program hasn't changed."} No workouts, sets or records were created: the plan&apos;s numbers are prescriptions until you log them.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="primary"><Link href={`/programs/${created.programId}`}>Open program</Link></Button>
          <Button variant="outline" onClick={() => { setDraft(null); setCreated(null); setStep("source"); setText(""); }}>Import another plan</Button>
        </div>
      </div>
    );
  }

  // ---------- source ----------
  if (step === "source" || !draft) {
    return (
      <div className="space-y-5">
        {savedDrafts.length > 0 && (
          <section className="space-y-2 rounded-lg border bg-card p-4">
            <h2 className="text-[15px] font-semibold">Continue a draft</h2>
            <ul className="divide-y">
              {savedDrafts.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setDraft(d.draft); setStep("review"); }}>
                    <span className="block truncate text-[14px] font-medium">{d.draft.programName}</span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {d.source_name ?? d.source_kind} · edited {formatDistanceToNow(new Date(d.updated_at), { addSuffix: true })}
                      {d.expires_at && ` · deleted ${formatDistanceToNow(new Date(d.expires_at), { addSuffix: true })} unless edited`}
                    </span>
                  </button>
                  <Button size="icon-sm" variant="danger" aria-label="Delete draft" onClick={() => void discard(d.id)}><Trash2 /></Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3 rounded-lg border bg-card p-5">
          <Segmented value={mode} onChange={setMode} options={[{ value: "paste", label: <><ClipboardPaste className="mr-1 inline size-3.5" />Paste</> }, { value: "file", label: <><FileUp className="mr-1 inline size-3.5" />Upload</> }]} />
          {mode === "paste" ? (
            <>
              <p className="text-[13.5px] text-muted-foreground">Paste a table from a spreadsheet, or text with one exercise per line (e.g. “Bench press 3×8–10, rest 2 min”). Headings like “Day 1” start a new workout.</p>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-[180px] font-mono text-[13px]" spellCheck={false}
                placeholder={"Day 1 – Upper\nBench press 4x6-8 rest 3 min RPE 8\nSeated cable row 3x10-12 rest 2 min"} aria-label="Plan text" />
              <Button variant="primary" onClick={() => readText(text, "paste", null)}>Read plan</Button>
            </>
          ) : (
            <>
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-7 text-center text-[14px] text-muted-foreground hover:bg-muted/60">
                <span className="flex items-center gap-2">{busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Choose a file</span>
                <span className="text-[12.5px]">
                  {documentsEnabled
                    ? `CSV, Excel (.xlsx) or text up to ${MAX_XLSX_BYTES / 1024 / 1024} MB · PDF up to 10 MB · photos (JPEG, PNG, WebP) up to 5 MB`
                    : `CSV, Excel (.xlsx) or text, up to ${MAX_XLSX_BYTES / 1024 / 1024} MB`}
                </span>
                <input type="file" className="sr-only" accept={`.csv,.tsv,.txt,.xlsx${documentsEnabled ? `,${Object.keys(DOCUMENT_TYPES).join(",")}` : ""}`}
                  onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <p className="text-[12.5px] text-muted-foreground">
                {documentsEnabled
                  ? "CSV, Excel and text are read on this device. PDFs and photos are sent to a reading service, and you're asked first."
                  : "Files are read on this device. Have a PDF or photo? Copy the table into Paste, or ask your trainer for the spreadsheet."}
              </p>
            </>
          )}
        </section>

        {pendingDoc && (
          <section className="space-y-3 rounded-lg border border-accent/40 bg-card p-5">
            <p className="flex items-start gap-2 text-[14px] font-semibold"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-accent" /> {pendingDoc.name}</p>
            {documentsEnabled ? (
              <>
                <p className="text-[13.5px] text-muted-foreground">To read a PDF or photo, Forma sends it to an external AI service, which transcribes the table. Forma doesn&apos;t store the file. The service handles it under its own data policy. Text inside the document is treated as data, never as instructions, and you review everything before a program is created.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void sendDocument(pendingDoc)}>{busy && <Loader2 className="animate-spin" />} Send and read</Button>
                  <Button variant="outline" onClick={() => setPendingDoc(null)}>Cancel</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13.5px] text-muted-foreground">Reading PDFs and photos isn&apos;t set up yet, so nothing was sent anywhere. Copy the table into the Paste box, export it as CSV or XLSX, or enter the plan by hand.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => { setPendingDoc(null); start({ ...emptyDraft(uuid()), sourceName: pendingDoc.name.slice(0, 200) }); }}>Enter by hand</Button>
                  <Button variant="outline" onClick={() => { setPendingDoc(null); setMode("paste"); }}>Paste instead</Button>
                </div>
              </>
            )}
          </section>
        )}

        <p className="text-center text-[13px] text-muted-foreground">
          No file? <button type="button" className="font-medium text-accent" onClick={() => start(emptyDraft(uuid()))}>Enter the plan by hand</button>
        </p>
      </div>
    );
  }

  // ---------- review / summary ----------
  const problems = draftProblems(draft);
  const summary = summarise(draft);
  const pickerFor = picker && draft.workouts.find((w) => w.id === picker.workoutId)?.exercises.find((e) => e.id === picker.exId);

  if (step === "summary") {
    return (
      <div className="space-y-4">
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="text-[17px] font-bold tracking-[-0.02em]">{draft.programName}</h2>
          <p className="text-[13.5px] text-muted-foreground">
            {summary.workouts} workout{summary.workouts === 1 ? "" : "s"} · {summary.exercises} exercise{summary.exercises === 1 ? "" : "s"}
            {summary.skipped > 0 && ` · ${summary.skipped} left out`}
          </p>
          <ul className="space-y-2 text-[13.5px]">
            {draft.workouts.filter((w) => w.exercises.some((e) => !e.skipped)).map((w) => (
              <li key={w.id}>
                <p className="font-semibold">{w.name}</p>
                <p className="text-muted-foreground">
                  {w.exercises.filter((e) => !e.skipped).map((e) => `${e.match.choice?.name} ${e.sets}×${e.repMin === e.repMax ? e.repMin : `${e.repMin}–${e.repMax}`}${e.perSide ? "/side" : ""}${e.warmupSets ? ` +${e.warmupSets} warm-up` : ""}${e.dropSegments ? ` +${e.dropSegments} drop` : ""}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          {summary.newFromCatalog.length > 0 && <p className="text-[13px] text-muted-foreground">Added to your library from the catalog: {summary.newFromCatalog.join(", ")}.</p>}
          {summary.defaultRest > 0 && <p className="text-[13px] text-muted-foreground">{summary.defaultRest} exercise{summary.defaultRest === 1 ? " has" : "s have"} no rest in the plan and will use your default ({fmtRest(defaultRestS)}).</p>}
          <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={makeActive} onChange={(e) => setMakeActive(e.target.checked)} className="size-4 accent-[var(--primary)]" />
            Make this my active program{hasActiveProgram ? " (replaces your current active program)" : ""}
          </label>
          <p className="text-[12.5px] text-muted-foreground">A new program is created. Existing programs and your workout history aren&apos;t changed, and no workouts, sets or records are created.</p>
        </section>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setStep("review")} disabled={busy}>Back to review</Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy || problems.length > 0}>{busy && <Loader2 className="animate-spin" />} Create program</Button>
        </div>
      </div>
    );
  }

  const openCodes = new Map<Flag["code"], { count: number; options: string[] }>();
  for (const e of draft.workouts.flatMap((w) => w.exercises)) {
    for (const f of e.flags) {
      if (f.resolved || !f.options?.length || e.skipped) continue;
      if (!["rest_range", "rest_unit", "effort_unclear", "load_unit", "drop_scope", "drop_count"].includes(f.code)) continue;
      const cur = openCodes.get(f.code) ?? { count: 0, options: f.options.map((o) => o.label.replace(/\d+(?:[.,]\d+)?/g, "").trim() || o.label) };
      cur.count++;
      openCodes.set(f.code, cur);
    }
  }
  const BULK_LABEL: Partial<Record<Flag["code"], [string, string[]]>> = {
    rest_range: ["Rest ranges", ["Use the shorter rest", "Use the longer rest"]],
    rest_unit: ["Rest without a unit", ["Seconds", "Minutes"]],
    effort_unclear: ["Effort without a scale", ["It's RIR", "It's RPE"]],
    load_unit: ["Loads without a unit", ["kg", "lb", "No load"]],
    drop_scope: ["Drop sets", ["Last set only", "Every set"]],
  };

  const bulk = [...openCodes].filter(([code, v]) => v.count >= 2 && BULK_LABEL[code]);

  return (
    <div className="space-y-4 pb-28">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted-foreground">Program name</span>
          <Input value={draft.programName} maxLength={120} onChange={(e) => update((d) => ({ ...d, programName: e.target.value }))} className="h-10 text-[16px] font-semibold" />
        </label>
        <p className="text-[12.5px] text-muted-foreground">
          {draft.sourceName ?? (draft.sourceKind === "manual" ? "Entered by hand" : "Pasted text")} ·{" "}
          {saveState === "saving" ? "Saving draft…" : saveState === "saved" ? "Draft saved" : saveState === "local" ? "Draft kept on this device (couldn't reach the server)" : "Draft"}
          {" · "}<button type="button" className="text-accent" onClick={() => void discard(draft.importId)}>Delete draft</button>
        </p>
        <div className="flex flex-wrap gap-2 text-[12px]">
          <Badge tone="positive"><CheckCircle2 /> Read from the plan</Badge>
          <Badge tone="accent">Dashed: interpreted, check it</Badge>
          <Badge tone="negative">Red: missing or needs an answer</Badge>
        </div>
        {draft.notices.map((n) => <p key={n} className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-[13px] text-muted-foreground"><AlertCircle className="mt-0.5 size-4 shrink-0" />{n}</p>)}
        {draft.notes.length > 0 && (
          <details className="text-[13px] text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Plan notes ({draft.notes.length}) · kept as the program description</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{draft.notes.map((n, i) => <li key={i} className="whitespace-pre-wrap break-words">{n}</li>)}</ul>
          </details>
        )}
        {draft.grid && <ColumnMapping draft={draft} onRemap={(p) => { if (confirm("Read the table again with these columns? Changes you made below are replaced.")) setDraft(remap(draft, p, ctx)); }} />}
      </section>

      {bulk.length > 0 && (
        <section className="space-y-2 rounded-lg border bg-card p-4">
          <h2 className="text-[14px] font-semibold">Answer once for every row</h2>
          {bulk.map(([code, v]) => (
            <div key={code} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-muted-foreground">{BULK_LABEL[code]![0]} ({v.count}):</span>
              {BULK_LABEL[code]![1].map((label, i) => (
                <Button key={label} size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => update((d) => applyOptionEverywhere(d, code, i))}>{label}</Button>
              ))}
            </div>
          ))}
        </section>
      )}

      {draft.workouts.map((w, wi) => (
        <section key={w.id} className="space-y-2 rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2">
            <Input value={w.name} maxLength={120} aria-label="Workout name" onChange={(e) => update((d) => ({ ...d, workouts: d.workouts.map((x) => (x.id === w.id ? { ...x, name: e.target.value } : x)) }))} className="h-10 flex-1 text-[16px] font-semibold" />
            <Button size="icon-sm" variant="danger" aria-label="Remove workout" onClick={() => { if (confirm(`Remove “${w.name}” from the import?`)) update((d) => ({ ...d, workouts: d.workouts.filter((x) => x.id !== w.id) })); }}><Trash2 /></Button>
          </div>
          <Input value={w.warmupNotes ?? ""} maxLength={1000} placeholder="Warm-up notes" onChange={(e) => update((d) => ({ ...d, workouts: d.workouts.map((x) => (x.id === w.id ? { ...x, warmupNotes: e.target.value || null } : x)) }))} className="h-9 text-[13px]" />
          {w.exercises.map((e, ei) => (
            <ExerciseRowEditor key={e.id} ex={e} index={ei} count={w.exercises.length} unit={unit} defaultRestS={defaultRestS}
              onChange={(next) => updateEx(w.id, e.id, next)}
              onMove={(dir) => update((d) => ({ ...d, workouts: d.workouts.map((x) => {
                if (x.id !== w.id) return x;
                const arr = [...x.exercises]; const j = ei + dir;
                if (j < 0 || j >= arr.length) return x;
                [arr[ei], arr[j]] = [arr[j], arr[ei]];
                return { ...x, exercises: arr };
              }) }))}
              onPickLibrary={() => setPicker({ workoutId: w.id, exId: e.id })}
              onCreate={() => setCreating({ workoutId: w.id, exId: e.id, name: e.name })} />
          ))}
          <Button variant="ghost" size="sm" onClick={() => update((d) => ({ ...d, workouts: d.workouts.map((x) => (x.id === w.id ? { ...x, exercises: [...x.exercises, rowToExercise({ ref: { label: "Added by hand", text: "" }, cells: {} }, ctx).exercise!] } : x)) }))}>
            <Plus /> Add exercise
          </Button>
          {wi === draft.workouts.length - 1 && null}
        </section>
      ))}
      <Button variant="outline" className="w-full" onClick={() => update((d) => ({ ...d, workouts: [...d.workouts, { id: uuid(), name: `Workout ${d.workouts.length + 1}`, source: null, warmupNotes: null, exercises: [] }] }))}><Plus /> Add workout</Button>

      <div className="pb-safe fixed inset-x-0 bottom-[64px] z-40 px-3 pb-3 md:bottom-0 md:left-60">
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-xl border bg-card/95 p-2 shadow-raised backdrop-blur-xl">
          <span className={cn("flex-1 px-2 text-[13px]", problems.length ? "text-negative" : "text-muted-foreground")}>
            {problems.length ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to fix` : `${summary.exercises} exercises ready`}
          </span>
          <Button variant="ghost" onClick={() => { setDraft(null); setStep("source"); }}>Back</Button>
          <Button variant="primary" disabled={problems.length > 0} onClick={() => setStep("summary")}>Review summary</Button>
        </div>
      </div>

      <ExercisePicker open={picker != null} onOpenChange={(o) => !o && setPicker(null)} exercises={library.filter((e) => !e.archived_at)}
        title={pickerFor ? `Exercise for “${pickerFor.name || "row"}”` : "Choose exercise"}
        onPick={(row) => {
          if (!picker) return;
          if (!library.some((x) => x.id === row.id)) setLibrary((l) => [...l, row]);
          choose(picker.workoutId, picker.exId, row);
        }} />
      {creating && (
        <ExerciseForm open initialName={creating.name} onOpenChange={(o) => { if (!o) setCreating(null); }}
          onCreated={(row) => { setLibrary((l) => [...l, row]); choose(creating.workoutId, creating.exId, row); setCreating(null); }} />
      )}
    </div>
  );
}

function ColumnMapping({ draft, onRemap }: { draft: PlanDraft; onRemap: (p: { sheet?: number; headerRow?: number | null; mapping?: (PlanField | null)[] }) => void }) {
  const g = draft.grid!;
  const [mapping, setMapping] = useState(g.mapping);
  useEffect(() => setMapping(g.mapping), [g.mapping]);
  const sheet = g.sheet >= 0 ? g.sheets[g.sheet] : null;
  const sample = sheet ? (g.headerRow != null ? sheet.rows[g.headerRow] : sheet.rows.find((r) => r.filter(Boolean).length >= 2) ?? []) : [];
  const changed = mapping.some((m, i) => m !== g.mapping[i]);
  return (
    <details className="text-[13px]" open={draft.workouts.every((w) => w.exercises.length === 0)}>
      <summary className="cursor-pointer font-medium">Columns{g.sheets.length > 1 ? " and sheets" : ""}</summary>
      <div className="mt-2 space-y-2">
        {g.sheets.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Sheet</span>
            <select value={g.sheet} onChange={(e) => onRemap({ sheet: Number(e.target.value) })} className="h-8 rounded-sm border border-input bg-card px-1">
              <option value={-1}>All sheets (one workout each)</option>
              {g.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
            </select>
          </label>
        )}
        {sheet && (
          <>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Header row</span>
              <select value={g.headerRow ?? ""} onChange={(e) => onRemap({ headerRow: e.target.value === "" ? null : Number(e.target.value) })} className="h-8 rounded-sm border border-input bg-card px-1">
                <option value="">None</option>
                {sheet.rows.slice(0, 15).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.filter(Boolean).join(" · ").slice(0, 40)}</option>)}
              </select>
            </label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(sample.length ? sample : mapping).map((h, i) => (
                <label key={i} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-muted-foreground" title={String(h ?? "")}>{(typeof h === "string" && h) || `Column ${i + 1}`}</span>
                  <select value={mapping[i] ?? ""} onChange={(e) => setMapping((m) => m.map((x, k) => (k === i ? ((e.target.value || null) as PlanField | null) : x)))} className="h-8 min-w-0 flex-1 rounded-sm border border-input bg-card px-1">
                    <option value="">Don&apos;t import</option>
                    {MAPPABLE_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {changed && <Button size="sm" variant="outline" onClick={() => onRemap({ mapping })}>Read again with these columns</Button>}
          </>
        )}
      </div>
    </details>
  );
}
