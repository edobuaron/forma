"use client";
import { AlertCircle, ArrowDown, ArrowUp, Check, CheckCircle2, ChevronDown, Info, Library, Plus, Search, Sparkles, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { CATALOG } from "@/lib/catalog/catalog";
import { saveSharedWorkout, type WorkoutSnapshot } from "@/lib/data/posts";
import type { DistanceUnit } from "@/lib/domain/running";
import {
  buildCopyDraft, canSave, draftProblems, missingFromPlan, planExtras, prescribedLoadLabel, rowProblems, saveError, toSavePayload,
  type CopyDraft, type CopyRow, type RequiredField, type Resolution,
} from "@/lib/domain/shared-copy";
import type { WeightUnit } from "@/lib/domain/types";
import { formatWeight } from "@/lib/domain/units";
import type { LibraryEntry } from "@/lib/plan-import/match";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar, Local, useMounted } from "./common";
import { SnapshotView } from "./post-card";

export type SaveScreenProps = {
  postId: string;
  author: { id: string; name: string; avatar?: string | null };
  sharedAt: string;
  snapshot: WorkoutSnapshot;
  library: LibraryEntry[];
  programs: { id: string; name: string; is_active: boolean }[];
  previousSaves: { created_at: string; program_id: string | null }[];
  unit: WeightUnit; distUnit: DistanceUnit;
  /** Fixture previews only: start from this draft state. */
  preset?: Partial<CopyDraft>;
};

const storeKey = (postId: string) => `forma.savePlan.${postId}`;

function loadStored(postId: string): CopyDraft | null {
  try { const raw = sessionStorage.getItem(storeKey(postId)); return raw ? (JSON.parse(raw) as CopyDraft) : null; } catch { return null; }
}

export function SaveWorkoutScreen(props: SaveScreenProps) {
  const { postId, author, snapshot, library, programs, unit } = props;
  const first = author.name.split(" ")[0];
  const mounted = useMounted();
  const [draft, setDraft] = useState<CopyDraft>(() => ({
    ...buildCopyDraft({ requestId: crypto.randomUUID(), plan: snapshot.plan ?? [], workoutName: snapshot.name, authorName: author.name, library, catalog: CATALOG }),
    ...props.preset,
  }));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState<{ programId: string; programName: string; again: boolean } | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // Keep edits (and the request id, so a retry after a reload can't duplicate) for this tab.
  useEffect(() => { if (!props.preset) { const s = loadStored(postId); if (s) setDraft(s); } }, [postId, props.preset]);
  useEffect(() => { if (mounted && !done && !props.preset) try { sessionStorage.setItem(storeKey(postId), JSON.stringify(draft)); } catch { /* storage unavailable */ } }, [draft, mounted, done, postId, props.preset]);

  const setRow = (key: string, patch: Partial<CopyRow>) => setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const move = (key: string, dir: -1 | 1) => setDraft((d) => {
    const i = d.rows.findIndex((r) => r.key === key), j = i + dir;
    if (i < 0 || j < 0 || j >= d.rows.length) return d;
    const rows = [...d.rows]; [rows[i], rows[j]] = [rows[j], rows[i]];
    return { ...d, rows };
  });
  const gaps = draft.rows.filter((r) => r.include && (missingFromPlan(r).length > 0 || r.source.planned === false)).length;
  const live = draft.rows.filter((r) => r.include);
  const problems = draftProblems(draft);
  const ready = canSave(draft);
  const newNames = [...new Set(live.filter((r) => r.resolution?.kind === "catalog" || r.resolution?.kind === "new").map((r) => r.resolution!.name))];

  async function save() {
    if (!ready) { toast.error(problems[0] ?? "Fill the highlighted fields first."); return; }
    setBusy(true); setFailed(null);
    try {
      const r = await saveSharedWorkout(createClient(), draft.requestId, postId, toSavePayload(draft));
      if (r.status === "error") { setFailed(saveError(r.code)); return; }
      const programName = draft.destination.kind === "new" ? draft.destination.name.trim() : programs.find((p) => p.id === (draft.destination as { programId: string }).programId)?.name ?? "your program";
      try { sessionStorage.removeItem(storeKey(postId)); } catch { /* storage unavailable */ }
      setDone({ programId: r.program_id, programName, again: r.status === "already_saved" });
    } catch {
      setFailed("Not saved. Check your connection and try again. Retrying won't make a duplicate.");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[600px] py-10 text-center">
        <CheckCircle2 className="mx-auto size-10 text-positive" />
        <p className="mt-3 text-[19px] font-bold tracking-tight">{done.again ? "Already saved" : "Saved to your programs"}</p>
        <p className="mx-auto mt-1 max-w-sm text-[14px] text-muted-foreground">
          &ldquo;{draft.workoutName.trim()}&rdquo; is in {done.programName}. It&apos;s your own copy: nothing was activated, and {first} isn&apos;t notified.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button asChild variant="primary"><Link href={`/programs/${done.programId}`}>Open program</Link></Button>
          <Button asChild variant="outline"><Link href="/community">Back to Community</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[680px] pb-28">
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={author.name} id={author.id} photo={author.avatar} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{snapshot.name}</p>
          <p className="truncate text-[13px] text-muted-foreground">From {author.name}&apos;s post · <Local>{() => new Date(props.sharedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</Local></p>
        </div>
      </div>

      {props.previousSaves.length > 0 && (
        <p role="status" className="mb-4 flex gap-2 rounded-lg bg-subtle/70 p-3 text-[13.5px]">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>You saved this <Local>{() => new Date(props.previousSaves[0].created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Local>. Saving again makes another copy.</span>
        </p>
      )}

      <section className="space-y-3">
        <Field label="Workout name"><Input value={draft.workoutName} maxLength={120} onChange={(e) => setDraft({ ...draft, workoutName: e.target.value })} /></Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">Save to</p>
          <Segmented size="md" value={draft.destination.kind} onChange={(k) => setDraft({
            ...draft,
            destination: k === "new" ? { kind: "new", name: `${snapshot.name} (from ${first})` } : { kind: "existing", programId: programs[0]?.id ?? "" },
          })} options={[{ value: "new", label: "New program" }, ...(programs.length ? [{ value: "existing" as const, label: "One of my programs" }] : [])]} />
          <div className="mt-2">
            {draft.destination.kind === "new" ? (
              <Input aria-label="New program name" value={draft.destination.name} maxLength={120} onChange={(e) => setDraft({ ...draft, destination: { kind: "new", name: e.target.value } })} />
            ) : (
              <Select aria-label="Program" value={draft.destination.programId} onChange={(e) => setDraft({ ...draft, destination: { kind: "existing", programId: e.target.value } })}>
                {programs.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? " (active)" : ""}</option>)}
              </Select>
            )}
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              {draft.destination.kind === "new" ? "A new program, not activated. Your current program doesn't change." : "Added as a new workout at the end. Existing workouts aren't changed."}
            </p>
          </div>
        </div>
      </section>

      <div className="mb-2 mt-7 flex items-end justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Exercises · {live.length}</h2>
        <p className="text-[12.5px] text-muted-foreground">{first}&apos;s plan, not what they lifted</p>
      </div>
      {gaps > 0 && (
        <p role="note" className="mb-3 flex gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-[13.5px]">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>{gaps === 1 ? "One exercise is" : `${gaps} exercises are`} missing details in {first}&apos;s plan. Fill the highlighted fields before saving.</span>
        </p>
      )}
      <ol className="space-y-3">
        {draft.rows.map((r, i) => (
          <ExerciseCopyRow key={r.key} row={r} index={i} count={draft.rows.length} unit={unit} first={first}
            onChange={(patch) => setRow(r.key, patch)} onChoose={() => setChoosing(r.key)} onMove={(dir) => move(r.key, dir)} />
        ))}
      </ol>

      <details className="group mt-6 rounded-xl border" open={showDone} onToggle={(e) => setShowDone((e.target as HTMLDetailsElement).open)}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-[14px] font-semibold">
          What {first} did <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t p-3">
          <p className="mb-2 text-[12.5px] text-muted-foreground">For reference only. Performed weights, reps, completed sets and records aren&apos;t copied.</p>
          <SnapshotView snap={snapshot} unit={unit} distUnit={props.distUnit} expanded />
        </div>
      </details>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/95 px-4 py-3 backdrop-blur md:bottom-0 md:left-60">
        <div className="mx-auto flex max-w-[680px] items-center gap-3">
          <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground" aria-live="polite">
            {failed ? <span className="font-medium text-destructive">{failed}</span>
              : !ready ? (problems[0] ?? "Fill the highlighted fields to save.")
              : <>Your own copy{newNames.length ? ` · adds ${newNames.length} exercise${newNames.length === 1 ? "" : "s"} to your library` : ""}. Nothing is published or activated.</>}
          </p>
          <Button variant="primary" size="lg" disabled={busy || !ready} onClick={save}>{busy ? "Saving…" : failed ? "Try again" : "Save"}</Button>
        </div>
      </div>

      <ExerciseChooser open={!!choosing} row={draft.rows.find((r) => r.key === choosing) ?? null} library={library}
        onClose={() => setChoosing(null)} onPick={(res) => { if (choosing) setRow(choosing, { resolution: res }); setChoosing(null); }} />
    </div>
  );
}

const FIELD: Record<RequiredField, { label: string; key: keyof CopyRow; min: number; max: number; suffix?: string }> = {
  sets: { label: "Sets", key: "sets", min: 1, max: 20 },
  repMin: { label: "Reps from", key: "repMin", min: 1, max: 100 },
  repMax: { label: "to", key: "repMax", min: 1, max: 100 },
  restS: { label: "Rest", key: "restS", min: 0, max: 1800, suffix: "s" },
};

function ExerciseCopyRow({ row: r, index, count, unit, first, onChange, onChoose, onMove }: {
  row: CopyRow; index: number; count: number; unit: WeightUnit; first: string;
  onChange: (p: Partial<CopyRow>) => void; onChoose: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const missing = new Set(missingFromPlan(r));
  const extras = planExtras(r);
  const problems = rowProblems(r);
  const res = r.resolution;
  const name = res?.name ?? r.source.name;
  if (!r.include) {
    return (
      <li className="flex min-h-12 items-center gap-3 rounded-xl border border-dashed px-4 text-[14px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate line-through">{r.source.name}</span>
        <Button size="sm" variant="ghost" className="h-9" onClick={() => onChange({ include: true })}><Undo2 /> Keep</Button>
      </li>
    );
  }
  return (
    <li className={cn("rounded-xl border bg-card p-3.5 shadow-card", problems.length > 0 && "border-warning/50")}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-[12px] font-semibold tabular">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-tight">{name}</p>
          {res && res.name.toLowerCase() !== r.source.name.toLowerCase() && <p className="truncate text-[12px] text-muted-foreground">{first}&apos;s plan: {r.source.name}</p>}
        </div>
        <div className="-mr-1.5 -mt-1 flex shrink-0">
          <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" /></button>
          <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" /></button>
          <button type="button" aria-label={`Leave out ${r.source.name}`} onClick={() => onChange({ include: false })} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
        </div>
      </div>

      <MatchLine row={r} onChange={onChange} onChoose={onChoose} />

      {r.source.planned === false && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">{first} added this during the workout, so there&apos;s no plan for it. Add your own targets or leave it out.</p>
      )}

      <div className="mt-3 grid grid-cols-4 gap-2">
        {(Object.keys(FIELD) as RequiredField[]).map((f) => {
          const spec = FIELD[f];
          const v = r[spec.key] as number | null;
          const gap = missing.has(f);
          return (
            <label key={f} className="block min-w-0">
              <span className={cn("mb-1 block truncate text-[11.5px] font-medium", gap ? "text-warning" : "text-muted-foreground")}>{spec.label}{gap ? " · add" : ""}</span>
              <span className="relative block">
                <input inputMode="numeric" type="number" min={spec.min} max={spec.max} value={v ?? ""} placeholder={gap ? "—" : undefined}
                  onChange={(e) => onChange({ [spec.key]: e.target.value === "" ? null : Math.round(Number(e.target.value)) } as Partial<CopyRow>)}
                  className={cn("h-11 w-full rounded-md border bg-card px-2.5 text-[15px] tabular outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    gap && v == null ? "border-warning bg-warning-soft/60" : "border-input", spec.suffix && "pr-6")} />
                {spec.suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">{spec.suffix}</span>}
              </span>
            </label>
          );
        })}
      </div>

      {extras.length > 0 && <p className="mt-2 text-[12.5px] text-muted-foreground">Also in the plan: {extras.join(" · ")}</p>}

      {r.prescribedLoadKg != null && (
        <label className="mt-3 flex min-h-12 items-center justify-between gap-3 rounded-md bg-subtle/60 px-3 py-2">
          <span className="text-[13px]">
            <span className="block font-medium">Prescribed load: {prescribedLoadLabel(r.prescribedLoadKg, r.source.convention, (kg) => formatWeight(kg, unit))}</span>
            <span className="block text-[12px] text-muted-foreground">From {first}&apos;s plan, not a weight they lifted. Off: you pick your own.</span>
          </span>
          <Switch checked={r.keepLoad} onCheckedChange={(v) => onChange({ keepLoad: v })} aria-label="Keep the prescribed load" />
        </label>
      )}

      {problems.length > 0 && <p className="mt-2 text-[12.5px] font-medium text-warning">{problems[0]}</p>}
    </li>
  );
}

function MatchLine({ row: r, onChange, onChoose }: { row: CopyRow; onChange: (p: Partial<CopyRow>) => void; onChoose: () => void }) {
  const res = r.resolution;
  const link = "font-semibold text-foreground underline-offset-2 hover:underline";
  if (res?.kind === "library") {
    return <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Check className="size-3.5 text-positive" /> In your library · <button type="button" className={link} onClick={onChoose}>Change</button></p>;
  }
  if (res?.kind === "catalog") {
    return <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Library className="size-3.5 shrink-0" /> New to your library, from the Forma catalog · <button type="button" className={link} onClick={onChoose}>Change</button></p>;
  }
  if (res?.kind === "new") {
    return (
      <div className="mt-2 flex items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
        <input aria-label="New exercise name" value={res.name} maxLength={120} onChange={(e) => onChange({ resolution: { kind: "new", name: e.target.value } })}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-[13.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button type="button" className={cn(link, "text-[12.5px]")} onClick={onChoose}>Change</button>
      </div>
    );
  }
  const proposed = r.match.status === "proposed" ? r.match.choice : null;
  return (
    <div className="mt-2 rounded-md bg-warning-soft/60 p-2.5 text-[13px]">
      {proposed ? <p>Is this your <span className="font-semibold">{proposed.name}</span>?</p> : <p>Not in your library yet.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {proposed && <Button size="sm" variant="primary" className="h-9" onClick={() => onChange({ resolution: proposed })}>Use {proposed.name}</Button>}
        {!proposed && <Button size="sm" variant="primary" className="h-9" onClick={() => onChange({ resolution: { kind: "new", name: r.source.name } })}><Plus /> Create &ldquo;{r.source.name}&rdquo;</Button>}
        <Button size="sm" variant="outline" className="h-9" onClick={onChoose}>{proposed ? "Choose another" : "Choose from library"}</Button>
      </div>
    </div>
  );
}

function ExerciseChooser({ open, row, library, onClose, onPick }: {
  open: boolean; row: CopyRow | null; library: LibraryEntry[]; onClose: () => void; onPick: (r: Resolution) => void;
}) {
  const [q, setQ] = useState("");
  useEffect(() => { if (open) setQ(""); }, [open]);
  const term = q.trim().toLowerCase();
  const inLib = useMemo(() => new Set(library.map((l) => l.catalogSlug).filter(Boolean)), [library]);
  const candidates = row?.match.candidates ?? [];
  const libHits = library.filter((l) => !l.archived && (!term || l.name.toLowerCase().includes(term) || l.aliases.some((a) => a.toLowerCase().includes(term)))).slice(0, 30);
  const catHits = term.length >= 2 ? CATALOG.filter((c) => !inLib.has(c.slug) && (c.name.toLowerCase().includes(term) || c.aliases.some((a) => a.includes(term)))).slice(0, 15) : [];
  const item = "flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-[14.5px] hover:bg-muted";
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title="Choose exercise" description={row ? `For “${row.source.name}”` : undefined}>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your library and the catalog" aria-label="Search exercises" className="h-11 pl-9" />
        </label>
        <div className="-mx-2 mt-2 max-h-[55dvh] overflow-y-auto">
          {!term && candidates.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[12px] font-semibold text-muted-foreground">Closest matches</p>
              {candidates.map((c, i) => (
                <button key={i} type="button" className={item} onClick={() => onPick(c.choice)}>
                  {c.choice.kind === "library" ? <Check className="size-4 text-muted-foreground" /> : <Library className="size-4 text-muted-foreground" />}
                  <span className="flex-1 truncate">{c.choice.name}</span>
                  <span className="text-[12px] text-muted-foreground">{c.choice.kind === "library" ? "Library" : "Catalog"}</span>
                </button>
              ))}
            </>
          )}
          <p className="px-2 pb-1 pt-3 text-[12px] font-semibold text-muted-foreground">Your library</p>
          {libHits.map((l) => (
            <button key={l.id} type="button" className={item} onClick={() => onPick({ kind: "library", id: l.id, name: l.name })}><span className="flex-1 truncate">{l.name}</span></button>
          ))}
          {libHits.length === 0 && <p className="px-2 py-2 text-[13px] text-muted-foreground">No matches.</p>}
          {catHits.length > 0 && <p className="px-2 pb-1 pt-3 text-[12px] font-semibold text-muted-foreground">Forma catalog</p>}
          {catHits.map((c) => (
            <button key={c.slug} type="button" className={item} onClick={() => onPick({ kind: "catalog", slug: c.slug, name: c.name })}><span className="flex-1 truncate">{c.name}</span></button>
          ))}
          <button type="button" className={cn(item, "mt-2 font-semibold")} onClick={() => onPick({ kind: "new", name: q.trim() || row?.source.name || "" })}>
            <Plus className="size-4" /> Create &ldquo;{q.trim() || row?.source.name}&rdquo;
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
