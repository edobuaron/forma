"use client";
import { ChevronDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { GENERIC_INCREMENT_KG, type WeightEntry } from "@/lib/catalog/catalog";
import {
  conventionProblem, defaultCategory, defaultProgression, defaultWeightEntry, e1rmAllowed, LOAD_TYPE_LABEL, WEIGHT_ENTRY_LABEL,
} from "@/lib/catalog/conventions";
import { cleanText } from "@/lib/catalog/names";
import { archiveExercise, createExercise, updateExercise, type ExerciseInput } from "@/lib/data/mutations";
import { listAttachments } from "@/lib/data/queries";
import type { AttachmentRow, ExerciseRow } from "@/lib/data/types";
import { sideTrackingSuitable } from "@/lib/domain/sides";
import { AttachmentChip, AttachmentPicker } from "@/components/workout/attachment-picker";
import { MuscleChips } from "./muscle-chips";
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
  name: "", aliases: [], primary_muscles: [], secondary_muscles: [], equipment: "cable", category: "isolation", load_type: "external",
  default_sets: 3, default_rep_min: 8, default_rep_max: 12, default_rest_s: 90, increment_kg: GENERIC_INCREMENT_KG.stack, increment_is_generic: true,
  min_load_kg: 0, available_loads_kg: null, weight_convention: "stack", progression: "double_progression", e1rm_eligible: false, notes: null, instructions: null,
  track_sides: false, default_attachment_state: null, default_attachment_id: null,
};

const CATEGORY_PRESETS: Record<ExerciseInput["category"], Partial<ExerciseInput>> = {
  compound: { progression: "double_progression" },
  isolation: { progression: "double_progression" },
  bodyweight: { progression: "bodyweight_reps" },
  weighted_bodyweight: { progression: "double_progression" },
  skill: { progression: "skill" },
};

/** Plain-language meaning of the weight field, shown under the selector. */
const ENTRY_HELP: Record<WeightEntry, string> = {
  total: "Enter everything on the bar or machine, bar included.",
  per_dumbbell: "Enter one dumbbell: a pair of 20 kg dumbbells is logged as 20 kg.",
  per_side: "Enter the plates on one side only.",
  stack: "Enter the number on the weight stack. Different machines aren't compared.",
  added: "Enter only the weight you add (belt, vest). 0 means bodyweight only.",
  assistance: "Enter the assistance from the machine or band. Less assistance means harder.",
};

const ENTRY_OPTIONS: Record<ExerciseInput["load_type"], WeightEntry[]> = {
  external: ["total", "per_dumbbell", "per_side", "stack"],
  bodyweight: ["added"],
  weighted_bodyweight: ["added"],
  assisted: ["assistance"],
};

export function ExerciseForm({ open, onOpenChange, exercise, initialName, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  exercise?: ExerciseRow;
  /** Prefill for a new exercise, e.g. the search that found nothing. */
  initialName?: string;
  /** Called with the new exercise instead of opening its page (used by pickers). */
  onCreated?: (row: ExerciseRow) => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<ExerciseInput>(() => (exercise ? { ...DEFAULTS, ...exercise } : { ...DEFAULTS, name: initialName?.trim().slice(0, 120) ?? "" }));
  const [loadsText, setLoadsText] = useState(exercise?.available_loads_kg?.join(", ") ?? "");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentRow[] | null>(null);
  const [pickAttachment, setPickAttachment] = useState(false);
  const showAttachment = v.equipment === "cable" || !!v.default_attachment_state;
  useEffect(() => {
    if (!open || !advanced || !showAttachment || attachments) return;
    listAttachments(createClient(), { includeArchived: true }).then(setAttachments, () => setAttachments([]));
  }, [open, advanced, showAttachment, attachments]);
  const defaultAttachment = {
    state: v.default_attachment_state, id: v.default_attachment_id,
    name: attachments?.find((a) => a.id === v.default_attachment_id)?.name ?? null,
  };
  const set = <K extends keyof ExerciseInput>(k: K, val: ExerciseInput[K]) => setV((cur) => ({ ...cur, [k]: val }));
  const num = (s: string) => (s === "" ? NaN : Number(s.replace(",", ".")));

  /**
   * Equipment or resistance changed. A new exercise takes the matching defaults (weight entry, category,
   * progression, generic increment); an existing one keeps its weight entry when it still fits.
   */
  function setKind(patch: Partial<Pick<ExerciseInput, "equipment" | "load_type">>) {
    setV((cur) => {
      const next = { ...cur, ...patch };
      const keep = exercise && ENTRY_OPTIONS[next.load_type].includes(cur.weight_convention);
      next.weight_convention = keep ? cur.weight_convention : defaultWeightEntry(next.equipment, next.load_type);
      if (!exercise) {
        if (patch.load_type) {
          next.category = defaultCategory(next.load_type);
          next.progression = defaultProgression(next.category, next.load_type);
        }
        if (next.increment_is_generic) next.increment_kg = GENERIC_INCREMENT_KG[next.weight_convention];
      }
      if (!e1rmAllowed({ loadType: next.load_type, category: next.category })) next.e1rm_eligible = false;
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = schema.safeParse(v);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    // Older exercises may predate these rules; only check a combination the user is changing.
    const kindChanged = !exercise || exercise.equipment !== v.equipment || exercise.load_type !== v.load_type || exercise.weight_convention !== v.weight_convention;
    const problem = kindChanged && conventionProblem({ equipment: v.equipment, loadType: v.load_type, weightEntry: v.weight_convention });
    if (problem) return toast.error(problem);
    if (v.e1rm_eligible && !exercise?.e1rm_eligible && !e1rmAllowed({ loadType: v.load_type, category: v.category })) {
      return toast.error("Estimated 1RM is only available for compound exercises with external load.");
    }
    let loads: number[] | null = null;
    if (loadsText.trim()) {
      loads = loadsText.split(/[,\s]+/).filter(Boolean).map(num);
      if (loads.some((l) => !Number.isFinite(l) || l < 0 || l > 1000)) return toast.error("Available loads must be numbers in kg, separated by commas.");
      loads = [...new Set(loads)].sort((a, b) => a - b);
    }
    setBusy(true);
    const {
      id: _id, user_id: _u, created_at: _c, updated_at: _up, archived_at: _a, slug: _s,
      catalog_slug: _cs, catalog_version: _cv, source: _src, ...payload
    } = v as ExerciseInput & Partial<ExerciseRow>;
    try {
      const db = createClient();
      const body = {
        ...payload, name: cleanText(v.name), available_loads_kg: loads,
        notes: cleanText(v.notes ?? "", { multiline: true }) || null,
        instructions: cleanText(v.instructions ?? "", { multiline: true }) || null,
      };
      if (exercise) await updateExercise(db, exercise.id, body);
      else {
        const row = await createExercise(db, body);
        if (onCreated) onCreated(row);
        else router.push(`/exercises/${row.id}`);
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

  const entryChoices = ENTRY_OPTIONS[v.load_type].includes(v.weight_convention) ? ENTRY_OPTIONS[v.load_type] : [v.weight_convention, ...ENTRY_OPTIONS[v.load_type]];
  const canE1rm = e1rmAllowed({ loadType: v.load_type, category: v.category });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={exercise ? "Edit exercise" : "Create exercise"} className="sm:max-w-xl">
        <form onSubmit={submit} className="space-y-5">
          <Field label="Name"><Input value={v.name} maxLength={120} onChange={(e) => set("name", e.target.value)} autoFocus={!exercise} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Equipment">
              <Select value={v.equipment} onChange={(e) => setKind({ equipment: e.target.value as ExerciseInput["equipment"] })}>
                {["barbell", "dumbbell", "cable", "machine", "smith", "bodyweight", "other"].map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
              </Select>
            </Field>
            <Field label="Resistance">
              <Select value={v.load_type} onChange={(e) => setKind({ load_type: e.target.value as ExerciseInput["load_type"] })}>
                {(Object.keys(LOAD_TYPE_LABEL) as ExerciseInput["load_type"][]).map((k) => <option key={k} value={k}>{LOAD_TYPE_LABEL[k]}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="The weight you log is" hint={ENTRY_HELP[v.weight_convention]}>
            <Select value={v.weight_convention} onChange={(e) => set("weight_convention", e.target.value as WeightEntry)} disabled={entryChoices.length === 1}>
              {entryChoices.map((k) => <option key={k} value={k}>{WEIGHT_ENTRY_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Primary muscles"><MuscleChips value={v.primary_muscles} onChange={(m) => set("primary_muscles", m)} /></Field>

          <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}
            className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-[14px] font-medium hover:bg-muted">
            Advanced settings
            <span className="flex items-center gap-1 text-[12.5px] font-normal text-muted-foreground">optional <ChevronDown className={cn("size-4 transition-transform", advanced && "rotate-180")} /></span>
          </button>

          {advanced && (
            <div className="space-y-5">
              <Field label="Movement category">
                <Select value={v.category} onChange={(e) => {
                  const c = e.target.value as ExerciseInput["category"];
                  setV((cur) => ({
                    ...cur, category: c, ...(exercise ? {} : CATEGORY_PRESETS[c]),
                    ...(e1rmAllowed({ loadType: cur.load_type, category: c }) ? {} : { e1rm_eligible: false }),
                  }));
                }}>
                  <option value="compound">Compound</option><option value="isolation">Isolation</option>
                  <option value="bodyweight">Bodyweight</option><option value="weighted_bodyweight">Weighted bodyweight</option>
                  <option value="skill">Skill / technical</option>
                </Select>
              </Field>
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
                <Field label="Smallest increment (kg)" hint={v.increment_is_generic ? "Generic default. Set your equipment's real smallest jump." : undefined}>
                  <Input inputMode="decimal" value={Number.isNaN(v.increment_kg) ? "" : v.increment_kg}
                    onChange={(e) => setV((cur) => ({ ...cur, increment_kg: num(e.target.value), increment_is_generic: false }))} />
                </Field>
              </div>
              <Field label="Available loads (kg, optional)" hint="Exact weights your gym has, e.g. 2.5, 5, 7.5, 10, 12.5 — suggestions will only use these.">
                <Input value={loadsText} onChange={(e) => setLoadsText(e.target.value)} placeholder="Leave empty to use the increment" />
              </Field>
              <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
                <span>
                  <span className="block text-[14px] font-medium">Show estimated 1RM</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {canE1rm ? "Only meaningful for heavy compound lifts." : "Only available for compound exercises with external load."}
                  </span>
                </span>
                <Switch checked={v.e1rm_eligible} disabled={!canE1rm && !v.e1rm_eligible} onCheckedChange={(c) => set("e1rm_eligible", c)} />
              </label>
              {(sideTrackingSuitable(v) || v.track_sides) && (
                <label className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
                  <span>
                    <span className="block text-[14px] font-medium">Track sides separately</span>
                    <span className="block text-[12px] text-muted-foreground">
                      New workouts log left and right with their own load and reps. You can switch per workout. Past workouts keep how they were logged.
                    </span>
                  </span>
                  <Switch checked={v.track_sides} onCheckedChange={(c) => set("track_sides", c)} />
                </label>
              )}
              {showAttachment && (
                <Field label="Default attachment" hint="Copied into new workouts; you can change it during the workout.">
                  <div><AttachmentChip value={defaultAttachment} onClick={() => setPickAttachment(true)} /></div>
                </Field>
              )}
              <Field label="Technique"><Textarea value={v.instructions ?? ""} maxLength={1000} onChange={(e) => set("instructions", e.target.value)} placeholder="Cues, setup, range of motion" /></Field>
              <Field label="Notes"><Textarea value={v.notes ?? ""} maxLength={1000} onChange={(e) => set("notes", e.target.value)} /></Field>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2">
            {exercise ? <Button type="button" variant="danger" onClick={toggleArchive}>{exercise.archived_at ? "Restore" : "Archive"}</Button> : <span />}
            <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="animate-spin" />} {exercise ? "Save" : "Create exercise"}</Button>
          </div>
        </form>
        {pickAttachment && (
          <AttachmentPicker
            open={pickAttachment}
            onOpenChange={setPickAttachment}
            title="Default attachment"
            value={defaultAttachment}
            attachments={attachments ?? []}
            onListChange={setAttachments}
            onChange={(ref) => setV((cur) => ({ ...cur, default_attachment_state: ref.state, default_attachment_id: ref.id }))}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ExerciseFormButton({ exercise, initialName, children, ...rest }: { exercise?: ExerciseRow; initialName?: string; children: React.ReactNode } & React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...rest} onClick={() => setOpen(true)}>{children}</Button>
      {open && <ExerciseForm open={open} onOpenChange={setOpen} exercise={exercise} initialName={initialName} />}
    </>
  );
}
