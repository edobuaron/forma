"use client";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Loader2, MoreHorizontal, Plus, Repeat, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { archiveProgram, duplicateProgram, setActiveProgram, snapshotProgram } from "@/lib/data/mutations";
import type { ProgramFull, TemplateWithExercises } from "@/lib/data/queries";
import type { ExerciseRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";
import { cn, uuid } from "@/lib/utils";

type TE = TemplateWithExercises["exercises"][number];
type T = Omit<TemplateWithExercises, "exercises"> & { exercises: TE[]; _new?: boolean };

function NumCell({ value, onChange, label, step = 1, className }: { value: number | null; onChange: (v: number | null) => void; label: string; step?: number; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        inputMode={step < 1 ? "decimal" : "numeric"}
        value={value ?? ""}
        onChange={(e) => { const s = e.target.value.replace(",", "."); onChange(s === "" ? null : Number.isFinite(Number(s)) ? Number(s) : value); }}
        className="h-9 w-full rounded-sm border border-input bg-card px-2 text-center text-[14px] tabular outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

export function ProgramEditor({ program, library, versions }: { program: ProgramFull; library: ExerciseRow[]; versions: { id: string; version: number; note: string | null; created_at: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description ?? "");
  const [templates, setTemplates] = useState<T[]>(program.templates);
  const [removedTemplates, setRemovedTemplates] = useState<string[]>([]);
  const [removedExercises, setRemovedExercises] = useState<string[]>([]);
  const [picker, setPicker] = useState<{ templateId: string; replaceId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");

  function mut(fn: (ts: T[]) => T[]) {
    setTemplates((cur) => fn(cur.map((t) => ({ ...t, exercises: [...t.exercises] }))));
    setDirty(true);
  }
  const patchT = (id: string, patch: Partial<T>) => mut((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const patchE = (tid: string, eid: string, patch: Partial<TE>) =>
    mut((ts) => ts.map((t) => (t.id === tid ? { ...t, exercises: t.exercises.map((e) => (e.id === eid ? { ...e, ...patch } : e)) } : t)));

  function moveE(tid: string, idx: number, dir: -1 | 1) {
    mut((ts) => ts.map((t) => {
      if (t.id !== tid) return t;
      const arr = [...t.exercises];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return t;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return { ...t, exercises: arr };
    }));
  }

  function moveT(idx: number, dir: -1 | 1) {
    mut((ts) => { const j = idx + dir; if (j < 0 || j >= ts.length) return ts; [ts[idx], ts[j]] = [ts[j], ts[idx]]; return [...ts]; });
  }

  function pick(ex: ExerciseRow) {
    if (!picker) return;
    if (picker.replaceId) {
      patchE(picker.templateId, picker.replaceId, { exercise_id: ex.id, exercise: ex });
    } else {
      mut((ts) => ts.map((t) => t.id === picker.templateId ? {
        ...t,
        exercises: [...t.exercises, {
          id: uuid(), template_id: t.id, exercise_id: ex.id, exercise: ex, position: t.exercises.length,
          sets: ex.default_sets, rep_min: ex.default_rep_min, rep_max: ex.default_rep_max, rest_s: ex.default_rest_s,
          target_rir: null, optional: false, notes: null,
        }],
      } : t));
    }
  }

  function addTemplate() {
    const id = uuid();
    mut((ts) => [...ts, { id, program_id: program.id, name: "New workout", day_of_week: null, position: ts.length, notes: null, warmup_notes: null, exercises: [], _new: true }]);
  }

  function duplicateT(t: T) {
    const id = uuid();
    mut((ts) => {
      const i = ts.findIndex((x) => x.id === t.id);
      const copy: T = { ...t, id, name: `${t.name} (copy)`, day_of_week: null, _new: true, exercises: t.exercises.map((e) => ({ ...e, id: uuid(), template_id: id })) };
      ts.splice(i + 1, 0, copy);
      return [...ts];
    });
  }

  async function save() {
    for (const t of templates) {
      if (!t.name.trim()) return toast.error("Every workout needs a name.");
      for (const e of t.exercises) {
        if (!(e.sets >= 1 && e.sets <= 20)) return toast.error(`${e.exercise.name}: sets must be 1–20.`);
        if (!(e.rep_min >= 1 && e.rep_max >= e.rep_min && e.rep_max <= 100)) return toast.error(`${e.exercise.name}: check the rep range.`);
        if (!(e.rest_s >= 0 && e.rest_s <= 1800)) return toast.error(`${e.exercise.name}: rest must be 0–1800 s.`);
      }
    }
    setBusy(true);
    const db = createClient();
    try {
      const r1 = await db.from("programs").update({ name: name.trim() || program.name, description: description || null }).eq("id", program.id);
      if (r1.error) throw r1.error;
      if (removedExercises.length) { const r = await db.from("template_exercises").delete().in("id", removedExercises); if (r.error) throw r.error; }
      if (removedTemplates.length) { const r = await db.from("workout_templates").delete().in("id", removedTemplates); if (r.error) throw r.error; }
      const tRows = templates.map((t, i) => ({ id: t.id, program_id: program.id, name: t.name.trim(), day_of_week: null, position: i + 1, notes: t.notes, warmup_notes: t.warmup_notes }));
      if (tRows.length) { const r = await db.from("workout_templates").upsert(tRows); if (r.error) throw r.error; }
      const eRows = templates.flatMap((t) => t.exercises.map((e, i) => ({
        id: e.id, template_id: t.id, exercise_id: e.exercise_id, position: i + 1, sets: e.sets, rep_min: e.rep_min, rep_max: e.rep_max,
        rest_s: e.rest_s, target_rir: e.target_rir, optional: e.optional, notes: e.notes,
      })));
      if (eRows.length) { const r = await db.from("template_exercises").upsert(eRows); if (r.error) throw r.error; }
      const v = await snapshotProgram(db, program.id, note.trim() || undefined);
      toast.success(`Saved as version ${v}`);
      setDirty(false);
      setNote("");
      setRemovedExercises([]);
      setRemovedTemplates([]);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-24">
      <Link href="/programs" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Programs</Link>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="Program name"
            className="w-full bg-transparent text-[26px] font-semibold tracking-[-0.02em] outline-none md:text-[30px]" />
          <Textarea value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} placeholder="Description and goals" className="min-h-[56px] text-[14px]" />
          <div className="flex items-center gap-2">
            {program.is_active ? <Badge tone="accent">Active program</Badge> : null}
            <Badge tone="outline">Version {program.version}</Badge>
          </div>
        </div>
        <Menu>
          <MenuTrigger className="grid size-10 place-items-center rounded-full outline-none hover:bg-muted" aria-label="Program options"><MoreHorizontal className="size-5" /></MenuTrigger>
          <MenuContent>
            {!program.is_active && <MenuItem onSelect={async () => { await setActiveProgram(createClient(), program.id); router.refresh(); }}><Star /> Make active</MenuItem>}
            <MenuItem onSelect={async () => { const id = await duplicateProgram(createClient(), program.id); router.push(`/programs/${id}`); }}><Copy /> Duplicate program</MenuItem>
            <MenuSeparator />
            <MenuItem destructive onSelect={async () => { if (confirm("Archive this program? Workout history is kept.")) { await archiveProgram(createClient(), program.id); router.push("/programs"); router.refresh(); } }}><Trash2 /> Archive</MenuItem>
          </MenuContent>
        </Menu>
      </div>

      <div className="space-y-4">
        {templates.map((t, ti) => (
          <Card key={t.id} className="p-4 md:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input value={t.name} onChange={(e) => patchT(t.id, { name: e.target.value })} className="h-10 min-w-0 flex-1 text-[16px] font-semibold" aria-label="Workout name" />
              <Menu>
                <MenuTrigger className="grid size-10 place-items-center rounded-full outline-none hover:bg-muted" aria-label="Workout options"><MoreHorizontal className="size-4" /></MenuTrigger>
                <MenuContent>
                  <MenuItem disabled={ti === 0} onSelect={() => moveT(ti, -1)}><ArrowUp /> Move up</MenuItem>
                  <MenuItem disabled={ti === templates.length - 1} onSelect={() => moveT(ti, 1)}><ArrowDown /> Move down</MenuItem>
                  <MenuItem onSelect={() => duplicateT(t)}><Copy /> Duplicate workout</MenuItem>
                  <MenuSeparator />
                  <MenuItem destructive onSelect={() => { mut((ts) => ts.filter((x) => x.id !== t.id)); if (!t._new) setRemovedTemplates((r) => [...r, t.id]); }}><Trash2 /> Delete workout</MenuItem>
                </MenuContent>
              </Menu>
            </div>
            <Input value={t.warmup_notes ?? ""} onChange={(e) => patchT(t.id, { warmup_notes: e.target.value || null })} placeholder="Warm-up notes" className="mb-3 h-9 text-[13px]" />

            <div className="space-y-2">
              {t.exercises.map((e, ei) => (
                <div key={e.id} className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="w-5 text-[12px] font-semibold text-muted-foreground tabular">{ei + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{e.exercise.name}</span>
                    <button aria-label="Move up" disabled={ei === 0} onClick={() => moveE(t.id, ei, -1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowUp className="size-4" /></button>
                    <button aria-label="Move down" disabled={ei === t.exercises.length - 1} onClick={() => moveE(t.id, ei, 1)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-30"><ArrowDown className="size-4" /></button>
                    <button aria-label="Substitute exercise" onClick={() => setPicker({ templateId: t.id, replaceId: e.id })} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><Repeat className="size-4" /></button>
                    <button aria-label="Remove exercise" onClick={() => { mut((ts) => ts.map((x) => (x.id === t.id ? { ...x, exercises: x.exercises.filter((y) => y.id !== e.id) } : x))); setRemovedExercises((r) => [...r, e.id]); }} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><Trash2 className="size-4" /></button>
                  </div>
                  <div className="grid max-w-md grid-cols-5 gap-2 pl-7">
                    <NumCell label="Sets" value={e.sets} onChange={(v) => patchE(t.id, e.id, { sets: v ?? 1 })} />
                    <NumCell label="Min" value={e.rep_min} onChange={(v) => patchE(t.id, e.id, { rep_min: v ?? 1 })} />
                    <NumCell label="Max" value={e.rep_max} onChange={(v) => patchE(t.id, e.id, { rep_max: v ?? 1 })} />
                    <NumCell label="Rest s" value={e.rest_s} onChange={(v) => patchE(t.id, e.id, { rest_s: v ?? 0 })} />
                    <NumCell label="RIR" value={e.target_rir} step={0.5} onChange={(v) => patchE(t.id, e.id, { target_rir: v })} />
                  </div>
                  <div className="mt-2 flex items-center gap-3 pl-7">
                    <Input value={e.notes ?? ""} onChange={(ev) => patchE(t.id, e.id, { notes: ev.target.value || null })} placeholder="Notes" className="h-8 flex-1 text-[13px]" />
                    <label className="flex items-center gap-2 text-[12px] text-muted-foreground">Optional <Switch checked={e.optional} onCheckedChange={(c) => patchE(t.id, e.id, { optional: c })} /></label>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPicker({ templateId: t.id })}><Plus /> Add exercise</Button>
          </Card>
        ))}
        <Button variant="outline" className="w-full" onClick={addTemplate}><Plus /> Add workout</Button>
      </div>

      {versions.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Version history</h2>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card text-[13px]">
            {versions.slice(0, 10).map((v) => (
              <li key={v.id} className="flex justify-between gap-3 px-4 py-2.5">
                <span><span className="font-medium">v{v.version}</span> <span className="text-muted-foreground">{v.note ?? ""}</span></span>
                <span className="text-muted-foreground tabular">{format(new Date(v.created_at), "d MMM yyyy, HH:mm")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">Past workouts keep the prescription they were performed with, regardless of later edits.</p>
        </div>
      )}

      {dirty && (
        <div className="pb-safe fixed inset-x-0 bottom-[58px] z-40 px-3 pb-3 md:bottom-0 md:left-60">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-xl border bg-card/95 p-2 shadow-xl backdrop-blur-xl">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe this change (optional)" className="h-10 flex-1 border-0 bg-transparent" />
            <Button variant="ghost" onClick={() => location.reload()}>Discard</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save</Button>
          </div>
        </div>
      )}

      <ExercisePicker open={picker != null} onOpenChange={(o) => !o && setPicker(null)} exercises={library} title={picker?.replaceId ? "Substitute exercise" : "Add exercise"} onPick={pick} />
    </div>
  );
}
