"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import { archiveExercise, createExercise, updateExercise, type ExerciseInput } from "@/lib/data/mutations";
import type { ExerciseRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  default_sets: z.number().int().min(1).max(20),
  default_rep_min: z.number().int().min(1).max(100),
  default_rep_max: z.number().int().min(1).max(100),
  default_rest_s: z.number().int().min(0).max(1800),
  increment_kg: z.number().positive("Increment must be > 0").max(50),
  min_load_kg: z.number().min(0).max(500),
}).refine((v) => v.default_rep_min <= v.default_rep_max, { message: "Rep minimum must be ≤ maximum" });

const DEFAULTS: ExerciseInput = {
  name: "", primary_muscles: [], secondary_muscles: [], equipment: "cable", category: "isolation", load_type: "external",
  default_sets: 3, default_rep_min: 8, default_rep_max: 12, default_rest_s: 90, increment_kg: 2.5, min_load_kg: 0,
  available_loads_kg: null, weight_convention: "total", progression: "double_progression", e1rm_eligible: false, notes: null, instructions: null,
};

const CATEGORY_PRESETS: Record<ExerciseInput["category"], Partial<ExerciseInput>> = {
  compound: { load_type: "external", progression: "double_progression" },
  isolation: { load_type: "external", progression: "double_progression", e1rm_eligible: false },
  bodyweight: { load_type: "bodyweight", progression: "bodyweight_reps", e1rm_eligible: false, equipment: "bodyweight" },
  weighted_bodyweight: { load_type: "weighted_bodyweight", progression: "double_progression", e1rm_eligible: false, equipment: "bodyweight", weight_convention: "added", increment_kg: 1.25 },
  skill: { progression: "skill", e1rm_eligible: false, equipment: "bodyweight" },
};

function MuscleChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(MUSCLE_LABELS).map(([k, label]) => {
        const on = value.includes(k);
        return (
          <button type="button" key={k} onClick={() => onChange(on ? value.filter((v) => v !== k) : [...value, k])}
            className={cn("h-8 rounded-full border px-3 text-[13px] transition-colors", on ? "border-accent bg-accent-soft font-medium text-accent" : "text-muted-foreground hover:bg-muted")}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function ExerciseForm({ open, onOpenChange, exercise }: { open: boolean; onOpenChange: (o: boolean) => void; exercise?: ExerciseRow }) {
  const router = useRouter();
  const [v, setV] = useState<ExerciseInput>(() => (exercise ? { ...DEFAULTS, ...exercise } : DEFAULTS));
  const [loadsText, setLoadsText] = useState(exercise?.available_loads_kg?.join(", ") ?? "");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ExerciseInput>(k: K, val: ExerciseInput[K]) => setV((cur) => ({ ...cur, [k]: val }));
  const num = (s: string) => (s === "" ? NaN : Number(s.replace(",", ".")));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(v);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    let loads: number[] | null = null;
    if (loadsText.trim()) {
      loads = loadsText.split(/[,\s]+/).filter(Boolean).map(num);
      if (loads.some((l) => !Number.isFinite(l) || l < 0 || l > 1000)) return toast.error("Available loads must be numbers in kg, separated by commas.");
      loads = [...new Set(loads)].sort((a, b) => a - b);
    }
    setBusy(true);
    const { id: _id, user_id: _u, created_at: _c, updated_at: _up, archived_at: _a, slug: _s, ...payload } = v as ExerciseInput & Partial<ExerciseRow>;
    try {
      const db = createClient();
      const body = { ...payload, name: v.name.trim(), available_loads_kg: loads, notes: v.notes || null, instructions: v.instructions || null };
      if (exercise) await updateExercise(db, exercise.id, body);
      else {
        const row = await createExercise(db, body);
        router.push(`/exercises/${row.id}`);
      }
      toast.success(exercise ? "Exercise updated" : "Exercise created");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!exercise) return;
    if (!exercise.archived_at && !confirm("Archive this exercise? History is kept; it just disappears from pickers.")) return;
    await archiveExercise(createClient(), exercise.id, !exercise.archived_at);
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={exercise ? "Edit exercise" : "New exercise"} className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <Field label="Name"><Input value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus={!exercise} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Movement category">
              <Select value={v.category} onChange={(e) => {
                const c = e.target.value as ExerciseInput["category"];
                setV((cur) => ({ ...cur, category: c, ...(exercise ? {} : CATEGORY_PRESETS[c]) }));
              }}>
                <option value="compound">Compound</option><option value="isolation">Isolation</option>
                <option value="bodyweight">Bodyweight</option><option value="weighted_bodyweight">Weighted bodyweight</option>
                <option value="skill">Skill / technical</option>
              </Select>
            </Field>
            <Field label="Equipment">
              <Select value={v.equipment} onChange={(e) => set("equipment", e.target.value as ExerciseInput["equipment"])}>
                {["barbell", "dumbbell", "cable", "machine", "smith", "bodyweight", "other"].map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Load type">
              <Select value={v.load_type} onChange={(e) => set("load_type", e.target.value as ExerciseInput["load_type"])}>
                <option value="external">External load</option><option value="bodyweight">Bodyweight</option>
                <option value="weighted_bodyweight">Bodyweight + added</option><option value="assisted">Assisted</option>
              </Select>
            </Field>
            <Field label="Weight entry">
              <Select value={v.weight_convention} onChange={(e) => set("weight_convention", e.target.value as ExerciseInput["weight_convention"])}>
                <option value="total">Total load</option><option value="per_dumbbell">Per dumbbell</option>
                <option value="per_side">Per side</option><option value="stack">Stack / pin</option><option value="added">Added weight</option>
              </Select>
            </Field>
          </div>
          <Field label="Primary muscles"><MuscleChips value={v.primary_muscles} onChange={(m) => set("primary_muscles", m)} /></Field>
          <Field label="Secondary muscles" hint="Count as half a set in weekly volume."><MuscleChips value={v.secondary_muscles} onChange={(m) => set("secondary_muscles", m)} /></Field>
          <div className="grid grid-cols-4 gap-3">
            <Field label="Sets"><Input inputMode="numeric" value={v.default_sets} onChange={(e) => set("default_sets", num(e.target.value))} /></Field>
            <Field label="Reps min"><Input inputMode="numeric" value={v.default_rep_min} onChange={(e) => set("default_rep_min", num(e.target.value))} /></Field>
            <Field label="Reps max"><Input inputMode="numeric" value={v.default_rep_max} onChange={(e) => set("default_rep_max", num(e.target.value))} /></Field>
            <Field label="Rest (s)"><Input inputMode="numeric" value={v.default_rest_s} onChange={(e) => set("default_rest_s", num(e.target.value))} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Progression">
              <Select value={v.progression} onChange={(e) => set("progression", e.target.value as ExerciseInput["progression"])}>
                <option value="double_progression">Double progression</option>
                <option value="reps_first">Reps first (confirm twice)</option>
                <option value="bodyweight_reps">Bodyweight reps</option>
                <option value="skill">Skill — no load progression</option>
                <option value="none">None</option>
              </Select>
            </Field>
            <Field label="Smallest increment (kg)"><Input inputMode="decimal" value={Number.isNaN(v.increment_kg) ? "" : v.increment_kg} onChange={(e) => set("increment_kg", num(e.target.value))} /></Field>
          </div>
          <Field label="Available loads (kg, optional)" hint="Exact weights your gym has, e.g. 2.5, 5, 7.5, 10, 12.5 — suggestions will only use these.">
            <Input value={loadsText} onChange={(e) => setLoadsText(e.target.value)} placeholder="Leave empty to use the increment" />
          </Field>
          <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
            <span>
              <span className="block text-[14px] font-medium">Show estimated 1RM</span>
              <span className="block text-[12px] text-muted-foreground">Only meaningful for heavy compound lifts with external load.</span>
            </span>
            <Switch checked={v.e1rm_eligible} onCheckedChange={(c) => set("e1rm_eligible", c)} />
          </label>
          <Field label="Technique"><Textarea value={v.instructions ?? ""} onChange={(e) => set("instructions", e.target.value)} placeholder="Cues, setup, range of motion" /></Field>
          <Field label="Notes"><Textarea value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
          <div className="flex items-center justify-between gap-2 pt-2">
            {exercise ? <Button type="button" variant="danger" onClick={toggleArchive}>{exercise.archived_at ? "Restore" : "Archive"}</Button> : <span />}
            <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {exercise ? "Save" : "Create exercise"}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function ExerciseFormButton({ exercise, children, ...rest }: { exercise?: ExerciseRow; children: React.ReactNode } & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...rest} onClick={() => setOpen(true)}>{children}</Button>
      {open && <ExerciseForm open={open} onOpenChange={setOpen} exercise={exercise} />}
    </>
  );
}
