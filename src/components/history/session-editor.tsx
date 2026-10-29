"use client";
import { format } from "date-fns";
import { Award, Check, ChevronLeft, Copy, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { AttachmentChip, AttachmentPicker } from "@/components/workout/attachment-picker";
import { formatSetLong, loadColumnLabel } from "@/components/workout/format";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { NumberField } from "@/components/workout/number-field";
import { ShortfallReasonField } from "@/components/workout/shortfall-reason";
import { prLabel, type PRType } from "@/lib/domain/prs";
import { recordLabel } from "@/components/workout/stream-comparison";
import { isShortOfPlan, shortfallLabel } from "@/lib/domain/shortfall";
import { doneWorkingSets, setPerformed, setVolumeKg, sideLabel, sideShort, SIDES, sideAsSet, sideTrackingSuitable } from "@/lib/domain/sides";
import type { AttachmentRef, ShortfallReason, Side, WeightUnit } from "@/lib/domain/types";
import { displayToKg, formatVolume, kgToDisplay } from "@/lib/domain/units";
import { deleteSession, recomputeRecords, saveSessionEdit } from "@/lib/data/mutations";
import type { SessionFull } from "@/lib/data/queries";
import { draftFromSession, savedDraft, toSessionEdit, validateDraft, type EditExercise, type SessionDraft } from "@/lib/data/session-edit";
import {
  copyLeftToRight, newSet, patchSide, removalKind, removeSet, restoreSet, setSideCompleted, switchMode, type RemovedSet, type SidePatch,
} from "@/lib/data/set-rows";
import { toAttachmentRef, toExerciseConfig, toLoggedSet, type AttachmentRow, type ExerciseRow, type PersonalRecordRow, type SetLogRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";
import { cn, formatMinutes, uuid } from "@/lib/utils";

type Ex = EditExercise;

const shortOfPlan = (items: Ex[]) => items.some((e) => isShortOfPlan(e.prescribed, doneWorkingSets(e.sets.map(toLoggedSet))));

const RECORDS_FAILED = "personal records couldn't be refreshed. They'll update the next time you save a workout with these exercises.";

export function SessionEditor({ session, unit, library, records, attachments: initialAttachments }: {
  session: SessionFull; unit: WeightUnit; library: ExerciseRow[]; records: PersonalRecordRow[]; attachments: AttachmentRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // The latest saved state. Edit and Cancel always start from it.
  const [saved, setSaved] = useState(() => draftFromSession(session));
  const [name, setName] = useState(saved.name);
  const [notes, setNotes] = useState(saved.notes);
  const [start, setStart] = useState(saved.start);
  const [minutes, setMinutes] = useState(saved.minutes);
  const [items, setItems] = useState<Ex[]>(saved.items);
  const [shortfallReason, setShortfallReason] = useState<ShortfallReason | null>(saved.shortfallReason);
  const [picker, setPicker] = useState(false);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [attachmentFor, setAttachmentFor] = useState<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  function load(d: SessionDraft) {
    setName(d.name);
    setNotes(d.notes);
    setStart(d.start);
    setMinutes(d.minutes);
    setItems(d.items);
    setShortfallReason(d.shortfallReason);
  }

  // Fresh server data (after router.refresh) becomes the saved state, without discarding edits in progress.
  useEffect(() => {
    const d = draftFromSession(session);
    setSaved(d);
    if (!editingRef.current) load(d);
  }, [session]);

  const stats = useMemo(() => {
    const ws = saved.items.flatMap((e) => e.sets.filter((s) => s.kind === "working").map((s) => ({ s: toLoggedSet(s), cfg: toExerciseConfig(e.exercise) })));
    return {
      sets: ws.filter(({ s }) => setPerformed(s)).length,
      volume: ws.reduce((a, { s, cfg }) => a + setVolumeKg(s, cfg), 0),
    };
  }, [saved]);

  function patchSet(exId: string, setId: string, patch: Partial<SetLogRow>) {
    setItems((cur) => cur.map((e) => (e.id === exId ? { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) } : e)));
  }

  function patchItem(exId: string, fn: (e: Ex) => Ex) {
    setItems((cur) => cur.map((e) => (e.id === exId ? fn(e) : e)));
  }

  function patchSideOf(e: Ex, setId: string, side: Side, patch: SidePatch) {
    patchItem(e.id, (x) => ({ ...x, sets: x.sets.map((s) => (s.id === setId ? patchSide(s, side, patch, e.exercise.load_type) : s)) }));
  }

  /** In History a side counts as done only when it is ticked; the other side is never filled in for you. */
  function toggleSide(e: Ex, setId: string, side: Side) {
    patchItem(e.id, (x) => ({
      ...x,
      sets: x.sets.map((s) => {
        if (s.id !== setId) return s;
        const on = !s[`${side}_completed`];
        // Sets in a saved workout always count as completed; validation asks for at least one side.
        return { ...setSideCompleted(s, side, on, on ? s.completed_at ?? session.started_at : null, {}, "bodyweight"), completed: true };
      }),
    }));
  }

  function addSet(e: Ex) {
    const last = e.sets[e.sets.length - 1];
    const base = newSet(uuid(), { kind: "working", sided: e.track_sides, from: last });
    const s: SetLogRow = {
      ...base, session_id: session.id, session_exercise_id: e.id, position: e.sets.length,
      reps: e.track_sides ? null : last?.reps ?? null, completed: true, completed_at: session.started_at,
    };
    patchItem(e.id, (x) => ({ ...x, sets: [...x.sets, s] }));
  }

  function deleteSet(e: Ex, setId: string) {
    const meaning = removalKind(e.prescribed, e.sets, setId);
    const { removed } = removeSet(e.sets, setId);
    if (!removed) return;
    patchItem(e.id, (x) => ({ ...x, sets: removeSet(x.sets, setId).sets }));
    toast(meaning === "planned" ? "Set removed. The plan is unchanged, so the workout shows fewer sets than planned." : "Set removed", {
      duration: 8000,
      action: { label: "Undo", onClick: () => patchItem(e.id, (x) => ({ ...x, sets: restoreSet(x.sets, removed as RemovedSet<SetLogRow>).sets })) },
    });
  }

  function toggleSides(e: Ex) {
    const r = switchMode(e.sets, !e.track_sides);
    patchItem(e.id, (x) => ({ ...x, track_sides: !x.track_sides, sets: r.sets.map((s) => ({ ...s, completed: true })) }));
    if (r.kept) toast(`${r.kept} logged set${r.kept === 1 ? "" : "s"} keep${r.kept === 1 ? "s" : ""} the way ${r.kept === 1 ? "it was" : "they were"} logged. New sets use the new mode.`);
  }

  function setAttachment(exId: string, ref: AttachmentRef) {
    patchItem(exId, (x) => ({ ...x, attachment_state: ref.state, attachment_id: ref.id, attachment_name: ref.name }));
  }

  function addExercise(ex: ExerciseRow) {
    const id = uuid();
    const def = attachments.find((a) => a.id === ex.default_attachment_id && !a.archived_at);
    setItems((cur) => [...cur, {
      id, session_id: session.id, exercise_id: ex.id, exercise: ex, template_exercise_id: null, substituted_for: null,
      position: cur.length, prescribed: { sets: ex.default_sets, rep_min: ex.default_rep_min, rep_max: ex.default_rep_max, rest_s: ex.default_rest_s }, notes: null,
      track_sides: ex.track_sides,
      attachment_state: ex.default_attachment_state === "attachment" && !def ? null : ex.default_attachment_state,
      attachment_id: def?.id ?? null, attachment_name: def?.name ?? null,
      sets: [{ ...newSet(uuid(), { kind: "working", sided: ex.track_sides }), session_id: session.id, session_exercise_id: id, completed: true, completed_at: session.started_at }],
    }]);
  }

  async function save() {
    const draft: SessionDraft = { name, notes, start, minutes, items, shortfallReason: shortOfPlan(items) ? shortfallReason : null };
    const problem = validateDraft(draft);
    if (problem) return toast.error(problem);

    setBusy(true);
    const db = createClient();
    try {
      await saveSessionEdit(db, session.id, toSessionEdit(draft));
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
      return;
    }
    const next = savedDraft(draft);
    const affected = new Map<string, ExerciseRow>();
    for (const e of [...saved.items, ...next.items]) affected.set(e.exercise_id, e.exercise);
    setSaved(next);
    load(next);
    setEditing(false);
    try {
      await recomputeRecords(db, [...affected.values()]);
      toast.success("Workout updated");
    } catch (e) {
      console.error(e);
      toast.error(`Workout updated, but ${RECORDS_FAILED}`);
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function remove() {
    if (!confirm("Delete this workout permanently? This cannot be undone.")) return;
    setBusy(true);
    const db = createClient();
    try {
      await deleteSession(db, session.id);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
      return;
    }
    try {
      await recomputeRecords(db, [...new Map(saved.items.map((e) => [e.exercise_id, e.exercise])).values()]);
    } catch (e) {
      console.error(e);
      toast.error(`Workout deleted, but ${RECORDS_FAILED}`);
    }
    router.replace("/history");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/history" className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> History
      </Link>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11 text-[20px] font-semibold" />
          ) : (
            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{saved.name}</h1>
          )}
          {editing ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="w-auto" />
              <div className="flex items-center gap-2">
                <Input type="number" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-20" aria-label="Duration in minutes" />
                <span className="text-[13px] text-muted-foreground">min</span>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[14px] text-muted-foreground tabular">
              {format(new Date(saved.start), "EEEE d MMMM yyyy · HH:mm")} · {formatMinutes(saved.minutes * 60000)} · {stats.sets} sets · {formatVolume(stats.volume, unit)}
            </p>
          )}
        </div>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => { load(saved); setEditing(true); }}><Pencil /> Edit</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { load(saved); setEditing(false); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save</Button>
          </div>
        )}
      </div>

      {editing ? (
        (shortOfPlan(items) || shortfallReason) && <div className="mb-4"><ShortfallReasonField value={shortfallReason} onChange={setShortfallReason} /></div>
      ) : (
        saved.shortfallReason && shortOfPlan(saved.items) && (
          <p className="mb-4 text-[13.5px] text-muted-foreground">Planned sets left out: {shortfallLabel[saved.shortfallReason].toLowerCase()}.</p>
        )
      )}

      {records.length > 0 && !editing && (
        <Card className="mb-4 flex flex-wrap gap-x-6 gap-y-2 p-4">
          {records.map((r) => (
            <span key={r.id} className="flex items-center gap-2 text-[13px]">
              <Award className="size-4 text-accent" />
              <span className="font-medium">{session.exercises.find((e) => e.exercise_id === r.exercise_id)?.exercise.name}</span>
              <span className="text-muted-foreground">{recordLabel(prLabel(r.type as PRType), r.side)}</span>
            </span>
          ))}
        </Card>
      )}

      <div className="space-y-3">
        {items.map((e) => (
          <Card key={e.id} className="p-4 md:p-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Link href={`/exercises/${e.exercise_id}`} className="text-[16px] font-semibold tracking-tight hover:underline">{e.exercise.name}</Link>
              {editing && (
                <button aria-label="Remove exercise" onClick={() => setItems((cur) => cur.filter((x) => x.id !== e.id))} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"><Trash2 className="size-4" /></button>
              )}
            </div>
            {(editing || e.attachment_state || e.track_sides) && (e.exercise.equipment === "cable" || e.attachment_state || e.track_sides || sideTrackingSuitable(e.exercise)) && (
              <div className="-mt-1 mb-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
                {(e.exercise.equipment === "cable" || e.attachment_state) && (
                  <AttachmentChip value={toAttachmentRef(e)} onClick={editing ? () => setAttachmentFor(e.id) : undefined} />
                )}
                {editing && (e.track_sides || sideTrackingSuitable(e.exercise)) ? (
                  <button type="button" aria-pressed={e.track_sides} onClick={() => toggleSides(e)}
                    className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 font-medium", e.track_sides ? "text-foreground" : "")}>
                    <span className={cn("grid size-4 place-items-center rounded-[4px] border", e.track_sides && "border-accent bg-accent text-accent-foreground")}>{e.track_sides && <Check className="size-3" strokeWidth={3} />}</span>
                    Track sides separately
                  </button>
                ) : e.track_sides && <span>Left and right logged separately</span>}
              </div>
            )}
            {!editing ? (
              <div className="space-y-1">
                {e.sets.filter((s) => s.completed).map((s) => {
                  const n = s.kind === "warmup" ? "W" : e.sets.filter((x) => x.kind === "working" && x.completed).indexOf(s) + 1;
                  const ls = toLoggedSet(s);
                  if (s.sided) {
                    return (
                      <div key={s.id} className="flex items-start text-[14px]">
                        <span className="mr-3 inline-block w-4 shrink-0 text-muted-foreground tabular">{n}</span>
                        <span className="flex flex-col gap-0.5 tabular">
                          {SIDES.map((side) => {
                            const v = sideAsSet(ls, side);
                            return (
                              <span key={side}>
                                <span className="mr-2 inline-block w-4 text-[12px] font-semibold text-muted-foreground" aria-label={sideLabel[side]}>{sideShort[side]}</span>
                                {v.completed ? formatSetLong(v, e.exercise.load_type, unit) : <span className="text-muted-foreground">not done</span>}
                                {v.completed && v.rir != null && <span className="ml-2 text-[12px] text-muted-foreground">RIR {v.rir}</span>}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={s.id} className="flex items-center justify-between text-[14px]">
                      <span className="tabular">
                        <span className="mr-3 inline-block w-4 text-muted-foreground">{n}</span>
                        {formatSetLong(ls, e.exercise.load_type, unit)}
                      </span>
                      {s.rir != null && <span className="text-[12px] text-muted-foreground">RIR {Number(s.rir)}</span>}
                    </div>
                  );
                })}
                {e.notes && <p className="mt-2 text-[13px] text-muted-foreground">{e.notes}</p>}
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-[40px_1fr_1fr_0.8fr_36px] gap-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Set</span><span className="text-center">{loadColumnLabel(e.exercise.load_type, unit)}</span><span className="text-center">Reps</span><span className="text-center">RIR</span><span />
                </div>
                {e.sets.map((s, i) => {
                  const assisted = e.exercise.load_type === "assisted";
                  const loadPatch = (v: number | null) => (assisted ? { assistance_kg: v == null ? null : displayToKg(v, unit) } : { weight_kg: v == null ? null : displayToKg(v, unit) });
                  const label = s.kind === "warmup" ? "Warm-up set" : `Set ${i + 1}`;
                  const kindButton = (
                    <button onClick={() => patchSet(e.id, s.id, { kind: s.kind === "warmup" ? "working" : "warmup" })} className="h-9 rounded-sm text-[13px] font-semibold text-muted-foreground hover:bg-muted" title="Toggle warm-up" aria-label={`${label}: toggle warm-up`}>
                      {s.kind === "warmup" ? "W" : i + 1}
                    </button>
                  );
                  const deleteButton = (
                    <button aria-label={`Remove ${label.toLowerCase()}`} onClick={() => deleteSet(e, s.id)} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
                  );
                  if (s.sided) {
                    return (
                      <div key={s.id} role="group" aria-label={`${label}, left and right`} className="border-t py-1 first:border-t-0">
                        <div className="flex items-center gap-2">
                          <span className="w-10">{kindButton}</span>
                          <span className="flex-1 text-[12px] text-muted-foreground">Tick each side done</span>
                          <button onClick={() => patchItem(e.id, (x) => ({ ...x, sets: x.sets.map((y) => (y.id === s.id ? copyLeftToRight(y, e.exercise.load_type) : y)) }))}
                            aria-label={`${label}: copy left values to right`} className="flex h-9 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-muted-foreground hover:bg-muted">
                            <Copy className="size-3.5" /> L → R
                          </button>
                          {deleteButton}
                        </div>
                        {SIDES.map((side) => {
                          const load = assisted ? s[`${side}_assistance_kg`] : s[`${side}_weight_kg`];
                          const done = s[`${side}_completed`];
                          const name = `${label} ${sideLabel[side].toLowerCase()}`;
                          return (
                            <div key={side} className="grid grid-cols-[40px_1fr_1fr_0.8fr_36px] items-center gap-2 py-0.5">
                              <span className="text-center text-[12px] font-semibold text-muted-foreground"><span aria-hidden>{sideShort[side]}</span><span className="sr-only">{sideLabel[side]}</span></span>
                              <NumberField ariaLabel={`${name} load`} value={load == null ? null : kgToDisplay(Number(load), unit)} max={unit === "kg" ? 1000 : 2200} onCommit={(v) => patchSideOf(e, s.id, side, loadPatch(v))} />
                              <NumberField ariaLabel={`${name} reps`} value={s[`${side}_reps`]} integer max={200} onCommit={(v) => patchSideOf(e, s.id, side, { reps: v })} />
                              <NumberField ariaLabel={`${name} RIR`} value={s[`${side}_rir`] == null ? null : Number(s[`${side}_rir`])} max={10} onCommit={(v) => patchSideOf(e, s.id, side, { rir: v })} />
                              <button aria-pressed={done} aria-label={done ? `${name}: done. Mark not done` : `${name}: not done. Mark done`} onClick={() => toggleSide(e, s.id, side)}
                                className={cn("grid size-9 place-items-center rounded-md", done ? "bg-done text-white dark:text-black" : "bg-subtle text-muted-foreground")}>
                                <Check className="size-4" strokeWidth={2.6} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  return (
                    <div key={s.id} className="grid grid-cols-[40px_1fr_1fr_0.8fr_36px] items-center gap-2 py-1">
                      {kindButton}
                      <NumberField ariaLabel={`${label} load`} value={(assisted ? s.assistance_kg : s.weight_kg) == null ? null : kgToDisplay(Number(assisted ? s.assistance_kg : s.weight_kg), unit)} max={unit === "kg" ? 1000 : 2200}
                        onCommit={(v) => patchSet(e.id, s.id, loadPatch(v))} />
                      <NumberField ariaLabel={`${label} reps`} value={s.reps} integer max={200} onCommit={(v) => patchSet(e.id, s.id, { reps: v })} />
                      <NumberField ariaLabel={`${label} RIR`} value={s.rir == null ? null : Number(s.rir)} max={10} onCommit={(v) => patchSet(e.id, s.id, { rir: v })} />
                      {deleteButton}
                    </div>
                  );
                })}
                <button onClick={() => addSet(e)} className="mt-1 flex h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-muted"><Plus className="size-4" /> Add set</button>
              </div>
            )}
          </Card>
        ))}
        {editing && <Button variant="outline" className="w-full" onClick={() => setPicker(true)}><Plus /> Add exercise</Button>}
      </div>

      <div className="mt-6">
        <p className="mb-1.5 px-1 text-[13px] font-medium text-muted-foreground">Notes</p>
        {editing ? <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /> : <p className="px-1 text-[14px] text-muted-foreground">{saved.notes || "—"}</p>}
      </div>

      {editing && (
        <div className="mt-10 border-t pt-6">
          <Button variant="danger" onClick={remove} disabled={busy}><Trash2 /> Delete workout</Button>
        </div>
      )}
      <ExercisePicker open={picker} onOpenChange={setPicker} exercises={library} onPick={addExercise} />
      <AttachmentPicker
        open={attachmentFor != null}
        onOpenChange={(o) => !o && setAttachmentFor(null)}
        value={(() => { const e = items.find((x) => x.id === attachmentFor); return e ? toAttachmentRef(e) : null; })()}
        attachments={attachments}
        onListChange={setAttachments}
        onChange={(ref) => attachmentFor && setAttachment(attachmentFor, ref)}
      />
    </div>
  );
}
