"use client";
import { AlertCircle, CheckCircle2, Copy, Download, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { CATALOG } from "@/lib/catalog/catalog";
import { WEIGHT_ENTRY_SHORT } from "@/lib/catalog/conventions";
import {
  IMPORT_COLUMNS, MAX_IMPORT_BYTES, previewImport, renameRow, type ExistingExercise, type ImportPreview, type ImportRow,
} from "@/lib/catalog/import";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import { importExercises, type ImportResult } from "@/lib/data/mutations";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function ImportExercises({ existing }: { existing: ExistingExercise[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function load(csv: string) {
    setText(csv);
    setResult(null);
    setSkip(new Set());
    setPreview(csv.trim() ? previewImport(csv, existing, CATALOG) : null);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) return toast.error(`That file is larger than ${MAX_IMPORT_BYTES / 1024} KB.`);
    load(await f.text());
  }

  const rows = preview?.rows ?? [];
  const toImport = rows.filter((r) => r.status === "valid" && !skip.has(r.line));
  const counts = useMemo(() => ({
    valid: rows.filter((r) => r.status === "valid").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    error: rows.filter((r) => r.status === "error").length,
  }), [rows]);

  async function save() {
    setBusy(true);
    try {
      const r = await importExercises(createClient(), toImport.map((x) => x.draft!));
      setResult(r);
      setPreview(null);
      setText("");
      router.refresh();
    } catch (e) {
      toast.error(`Nothing was imported: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4 rounded-lg border bg-card p-5">
        <p className="flex items-center gap-2 text-[16px] font-semibold"><CheckCircle2 className="size-5 text-positive" /> Imported {result.added.length} exercise{result.added.length === 1 ? "" : "s"}</p>
        {result.skipped.length > 0 && (
          <p className="text-[13.5px] text-muted-foreground">
            Skipped {result.skipped.length} already in your library (not changed): {result.skipped.map((s) => s.existing_name).join(", ")}.
          </p>
        )}
        <p className="text-[13.5px] text-muted-foreground">Imported exercises are in your library. Add them to a workout under Programs. Your programs haven&apos;t changed.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="primary"><Link href="/exercises">Go to library</Link></Button>
          <Button variant="outline" onClick={() => setResult(null)}>Import another file</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-[15px] font-semibold">1. Get your list into the template</h2>
        <p className="text-[13.5px] text-muted-foreground">
          Only <span className="font-medium text-foreground">name</span> is required. Leave other columns empty to use defaults. Separate several muscles with “;”.
        </p>
        <details className="text-[13px] text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Column reference</summary>
          <ul className="mt-2 space-y-1">
            <li><code>name</code>: up to 120 characters. Rows matching an exercise you already have are skipped.</li>
            <li><code>aliases</code>: other names for search, separated by “;”.</li>
            <li><code>equipment</code>: barbell, dumbbell, cable, machine, smith, bodyweight or other.</li>
            <li><code>load_type</code>: external, bodyweight, weighted (bodyweight + added) or assisted.</li>
            <li><code>weight_entry</code>: what the logged number means: total (bar included), per dumbbell, per side, stack, added (0 = bodyweight) or assistance.</li>
            <li><code>primary_muscles</code>, <code>secondary_muscles</code>: {Object.values(MUSCLE_LABELS).join(", ")}.</li>
            <li><code>category</code>: compound, isolation, bodyweight, weighted bodyweight or skill. Skill work is never auto-progressed.</li>
            <li><code>sets</code>, <code>rep_min</code>, <code>rep_max</code>, <code>rest_seconds</code>: defaults when added to a workout.</li>
            <li><code>increment_kg</code>: your smallest load jump. Left empty, a generic default is used and labelled as such.</li>
            <li><code>e1rm</code>: yes/no. Only allowed for compound exercises with external load.</li>
            <li><code>instructions</code>, <code>notes</code>: plain text, up to 1000 characters.</li>
          </ul>
        </details>
        <Button asChild variant="outline" size="sm"><a href="/exercise-import-template.csv" download><Download /> Download template</a></Button>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h2 className="text-[15px] font-semibold">2. Choose the file or paste it</h2>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-[14px] text-muted-foreground hover:bg-muted/60">
          <FileUp className="size-4" /> Choose a .csv file
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <Textarea value={text} onChange={(e) => load(e.target.value)} placeholder={`${IMPORT_COLUMNS.slice(0, 5).join(",")},…`} className="min-h-[120px] font-mono text-[13px]" spellCheck={false} />
      </section>

      {preview && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">3. Check the preview</h2>
          {preview.fileErrors.map((e) => <p key={e} className="flex items-start gap-2 rounded-md bg-negative/10 px-3 py-2.5 text-[13.5px] text-negative"><AlertCircle className="mt-0.5 size-4 shrink-0" />{e}</p>)}
          {preview.ignoredColumns.length > 0 && <p className="text-[13px] text-muted-foreground">Ignored unknown columns: {preview.ignoredColumns.join(", ")}.</p>}
          {rows.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 text-[13px]">
                <Badge tone="positive">{counts.valid} ready</Badge>
                <Badge tone="outline">{counts.duplicate} already in library</Badge>
                {counts.error > 0 && <Badge tone="negative">{counts.error} with errors</Badge>}
              </div>
              <p className="text-[12.5px] text-muted-foreground">Rows with errors and duplicates are skipped. Rename a duplicate to import it as a separate exercise, or fix errors in your file and choose it again.</p>
              <div className="divide-y overflow-hidden rounded-lg border bg-card">
                {rows.map((r) => (
                  <PreviewRow key={r.line} row={r} skipped={skip.has(r.line)}
                    onToggle={() => setSkip((cur) => { const n = new Set(cur); if (n.has(r.line)) n.delete(r.line); else n.add(r.line); return n; })}
                    onRename={(name) => setPreview((p) => p && { ...p, rows: renameRow(p.rows, r.line, name, existing, CATALOG) })} />
                ))}
              </div>
              <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] flex items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-card md:bottom-4">
                <span className="text-[13px] text-muted-foreground">Existing exercises are never changed.</span>
                <Button variant="primary" disabled={busy || toImport.length === 0} onClick={save}>
                  {busy && <Loader2 className="animate-spin" />} Import {toImport.length} exercise{toImport.length === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function PreviewRow({ row, skipped, onToggle, onRename }: { row: ImportRow; skipped: boolean; onToggle: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState(row.raw.name ?? "");
  const d = row.draft;
  return (
    <div className={cn("space-y-1.5 px-4 py-3", (row.status !== "valid" || skipped) && "bg-muted/40")}>
      <div className="flex items-start gap-3">
        <span className="w-10 shrink-0 pt-0.5 text-[12px] tabular text-muted-foreground">Line {row.line}</span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[14.5px] font-medium", skipped && "line-through opacity-60")}>{d?.name ?? (row.raw.name?.trim() || "(no name)")}</p>
          {d && (
            <p className="truncate text-[12.5px] text-muted-foreground">
              {d.primary_muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(", ") || "no muscles"} · {d.equipment} · {WEIGHT_ENTRY_SHORT[d.weight_convention]} · {d.default_sets}×{d.default_rep_min}–{d.default_rep_max}
              {d.increment_is_generic ? " · generic increment" : ` · +${d.increment_kg} kg steps`}
            </p>
          )}
        </div>
        {row.status === "valid" && (
          <button type="button" onClick={onToggle} className="shrink-0 text-[12.5px] font-medium text-accent">{skipped ? "Include" : "Skip"}</button>
        )}
        {row.status === "duplicate" && <Badge tone="outline" className="shrink-0"><Copy className="size-3" /> Duplicate</Badge>}
        {row.status === "error" && <Badge tone="negative" className="shrink-0">Error</Badge>}
      </div>
      <div className="pl-[52px]">
        {row.errors.map((e) => <p key={e} className="text-[12.5px] text-negative">{e}</p>)}
        {row.duplicateOf && (
          <p className="text-[12.5px] text-muted-foreground">
            {row.duplicateOf.kind === "library"
              ? `Already in your library as “${row.duplicateOf.name}”${row.duplicateOf.archived ? " (archived)" : ""}. It won't be changed.`
              : `Same name as an earlier row (“${row.duplicateOf.name}”).`}
          </p>
        )}
        {row.warnings.map((w) => <p key={w} className="text-[12.5px] text-muted-foreground">{w}</p>)}
        {(row.status === "duplicate" || row.errors.some((e) => e.startsWith("Name"))) && (
          <form className="mt-1.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); onRename(name); }}>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="h-8 text-[13px]" aria-label={`New name for line ${row.line}`} />
            <Button type="submit" size="sm" variant="outline">Rename</Button>
          </form>
        )}
      </div>
    </div>
  );
}
