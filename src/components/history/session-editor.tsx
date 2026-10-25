"use client";
import { format } from "date-fns";
import { Award, ChevronLeft, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { formatSetLong, loadColumnLabel } from "@/components/workout/format";
import { ExercisePicker } from "@/components/workout/exercise-picker";
import { NumberField } from "@/components/workout/number-field";
import { prLabel, type PRType } from "@/lib/domain/prs";
import type { WeightUnit } from "@/lib/domain/types";
import { displayToKg, formatVolume, kgToDisplay } from "@/lib/domain/units";
import { deleteSession, recomputeRecords } from "@/lib/data/mutations";
import type { SessionFull } from "@/lib/data/queries";
import { toLoggedSet, type ExerciseRow, type PersonalRecordRow, type SetLogRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";
import { formatMinutes, uuid } from "@/lib/utils";

type Ex = SessionFull["exercises"][number];

function toLocalInput(iso: string) {
  const d = new Date(iso);
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export function SessionEditor({ session, unit, library, records }: { session: SessionFull; unit: WeightUnit; library: ExerciseRow[]; records: PersonalRecordRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(session.name);
  const [notes, setNotes] = useState(session.notes ?? "");
  const [start, setStart] = useState(toLocalInput(session.started_at));
  const [minutes, setMinutes] = useState(session.ended_at ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000) : 60);
  const [items, setItems] = useState<Ex[]>(session.exercises);
  const [picker, setPicker] = useState(false);
  const duration = session.ended_at ? new Date(session.ended_at).getTime() - new Date(session.started_at).getTime() : 0;

  const stats = useMemo(() => {
    const ws = session.exercises.flatMap((e) => e.sets.filter((s) => s.completed && s.kind === "working"));
    return { sets: ws.length, volume: ws.reduce((a, s) => a + Number(s.weight_kg ?? 0) * (s.reps ?? 0), 0) };
  }, [session]);

  function patchSet(exId: string, setId: string, patch: Partial<SetLogRow>) {
    setItems((cur) => cur.map((e) => (e.id === exId ? { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) } : e)));
  }

  function addSet(e: Ex) {
    const last = e.sets[e.sets.length - 1];
    const s: SetLogRow = {
      id: uuid(), session_id: session.id, session_exercise_id: e.id, position: e.sets.length, kind: "working",
      weight_kg: last?.weight_kg ?? null, assistance_kg: last?.assistance_kg ?? null, reps: last?.reps ?? null, rir: null,
      completed: true, completed_at: session.started_at, notes: null,
    };
    setItems((cur) => cur.map((x) => (x.id === e.id ? { ...x, sets: [...x.sets, s] } : x)));
  }

  function addExercise(ex: ExerciseRow) {
    const id = uuid();
    setItems((cur) => [...cur, {
      id, session_id: session.id, exercise_id: ex.id, exercise: ex, template_exercise_id: null, substituted_for: null,
      position: cur.length, prescribed: { sets: ex.default_sets, rep_min: ex.default_rep_min, rep_max: ex.default_rep_max, rest_s: ex.default_rest_s }, notes: null,
      sets: [{ id: uuid(), session_id: session.id, session_exercise_id: id, position: 0, kind: "working", weight_kg: null, assistance_kg: null, reps: null, rir: null, completed: true, completed_at: session.started_at, notes: null }],
    }]);
  }

  async function save() {
    // Validate
    for (const e of items) for (const s of e.sets) {
      if (s.reps == null || s.reps < 1 || !Number.isInteger(s.reps)) return toast.error(`${e.exercise.name}: every set needs reps (whole number ≥ 1).`);
      if (e.exercise.load_type === "external" && s.weight_kg == null) return toast.error(`${e.exercise.name}: enter a weight for every set.`);
    }
    if (!name.trim()) return toast.error("Name the workout.");
    const startedAt = new Date(start);
    if (Number.isNaN(startedAt.getTime())) return toast.error("Invalid date.");
    if (!(minutes >= 1 && minutes <= 600)) return toast.error("Duration must be 1–600 minutes.");

    setBusy(true);
    const db = createClient();
    try {
      const keptEx = new Set(items.map((e) => e.id));
      const removedEx = session.exercises.filter((e) => !keptEx.has(e.id)).map((e) => e.id);
      const keptSets = new Set(items.flatMap((e) => e.sets.map((s) => s.id)));
      const removedSets = session.exercises.flatMap((e) => e.sets).filter((s) => !keptSets.has(s.id) && keptEx.has(s.session_exercise_id)).map((s) => s.id);

      const { error: e1 } = await db.from("workout_sessions").update({
        name: name.trim(), notes: notes || null, started_at: startedAt.toISOString(),
        ended_at: new Date(startedAt.getTime() + minutes * 60000).toISOString(),
      }).eq("id", session.id);
      if (e1) throw e1;
      if (removedSets.length) { const { error } = await db.from("set_logs").delete().in("id", removedSets); if (error) throw error; }
      if (removedEx.length) { const { error } = await db.from("session_exercises").delete().in("id", removedEx); if (error) throw error; }
      const seRows = items.map((e, i) => ({ id: e.id, session_id: session.id, exercise_id: e.exercise_id, template_exercise_id: e.template_exercise_id, substituted_for: e.substituted_for, position: i, prescribed: e.prescribed, notes: e.notes }));
      { const { error } = await db.from("session_exercises").upsert(seRows); if (error) throw error; }
      const setRows = items.flatMap((e) => e.sets.map((s, i) => ({ ...s, session_exercise_id: e.id, session_id: session.id, position: i, completed: true, completed_at: s.completed_at ?? startedAt.toISOString() })));
      if (setRows.length) { const { error } = await db.from("set_logs").upsert(setRows); if (error) throw error; }

      const affected = new Map<string, ExerciseRow>();
      for (const e of [...session.exercises, ...items]) affected.set(e.exercise_id, e.exercise);
      await recomputeRecords(db, [...affected.values()]);
      toast.success("Workout updated");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this workout permanently? This cannot be undone.")) return;
    setBusy(true);
    try {
      const db = createClient();
      await deleteSession(db, session.id);
      await recomputeRecords(db, [...new Map(session.exercises.map((e) => [e.exercise_id, e.exercise])).values()]);
      router.replace("/history");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
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
            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{session.name}</h1>
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
              {format(new Date(session.started_at), "EEEE d MMMM yyyy · HH:mm")} · {formatMinutes(duration)} · {stats.sets} sets · {formatVolume(stats.volume, unit)}
            </p>
          )}
        </div>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil /> Edit</Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setItems(session.exercises); setName(session.name); setNotes(session.notes ?? ""); }}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save</Button>
          </div>
        )}
      </div>

      {records.length > 0 && !editing && (
        <Card className="mb-4 flex flex-wrap gap-x-6 gap-y-2 p-4">
          {records.map((r) => (
            <span key={r.id} className="flex items-center gap-2 text-[13px]">
              <Award className="size-4 text-accent" />
              <span className="font-medium">{session.exercises.find((e) => e.exercise_id === r.exercise_id)?.exercise.name}</span>
              <span className="text-muted-foreground">{prLabel(r.type as PRType)}</span>
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
            {!editing ? (
              <div className="space-y-1">
                {e.sets.filter((s) => s.completed).map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between text-[14px]">
                    <span className="tabular">
                      <span className="mr-3 inline-block w-4 text-muted-foreground">{s.kind === "warmup" ? "W" : e.sets.filter((x) => x.kind === "working" && x.completed).indexOf(s) + 1}</span>
                      {formatSetLong(toLoggedSet({ ...s, weight_kg: s.weight_kg == null ? null : Number(s.weight_kg), assistance_kg: s.assistance_kg == null ? null : Number(s.assistance_kg) }), e.exercise.load_type, unit)}
                    </span>
                    {s.rir != null && <span className="text-[12px] text-muted-foreground">RIR {Number(s.rir)}</span>}
                    <span className="sr-only">{i}</span>
                  </div>
                ))}
                {e.notes && <p className="mt-2 text-[13px] text-muted-foreground">{e.notes}</p>}
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-[40px_1fr_1fr_0.8fr_36px] gap-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Set</span><span className="text-center">{loadColumnLabel(e.exercise.load_type, unit)}</span><span className="text-center">Reps</span><span className="text-center">RIR</span><span />
                </div>
                {e.sets.map((s, i) => {
                  const assisted = e.exercise.load_type === "assisted";
                  const load = assisted ? s.assistance_kg : s.weight_kg;
                  return (
                    <div key={s.id} className="grid grid-cols-[40px_1fr_1fr_0.8fr_36px] items-center gap-2 py-1">
                      <button onClick={() => patchSet(e.id, s.id, { kind: s.kind === "warmup" ? "working" : "warmup" })} className="h-9 rounded-sm text-[13px] font-semibold text-muted-foreground hover:bg-muted" title="Toggle warm-up">
                        {s.kind === "warmup" ? "W" : i + 1}
                      </button>
                      <NumberField ariaLabel="Load" value={load == null ? null : kgToDisplay(Number(load), unit)} max={unit === "kg" ? 1000 : 2200}
                        onCommit={(v) => patchSet(e.id, s.id, assisted ? { assistance_kg: v == null ? null : displayToKg(v, unit) } : { weight_kg: v == null ? null : displayToKg(v, unit) })} />
                      <NumberField ariaLabel="Reps" value={s.reps} integer max={200} onCommit={(v) => patchSet(e.id, s.id, { reps: v })} />
                      <NumberField ariaLabel="RIR" value={s.rir == null ? null : Number(s.rir)} max={10} onCommit={(v) => patchSet(e.id, s.id, { rir: v })} />
                      <button aria-label="Delete set" onClick={() => setItems((cur) => cur.map((x) => (x.id === e.id ? { ...x, sets: x.sets.filter((y) => y.id !== s.id) } : x)))} className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
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
        {editing ? <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /> : <p className="px-1 text-[14px] text-muted-foreground">{session.notes || "—"}</p>}
      </div>

      {editing && (
        <div className="mt-10 border-t pt-6">
          <Button variant="danger" onClick={remove} disabled={busy}><Trash2 /> Delete workout</Button>
        </div>
      )}
      <ExercisePicker open={picker} onOpenChange={setPicker} exercises={library} onPick={addExercise} />
    </div>
  );
}
