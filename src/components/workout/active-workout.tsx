"use client";
import { format } from "date-fns";
import { ChevronLeft, Cloud, CloudOff, Loader2, MoreHorizontal, Plus, Timer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { setProblem, sideValues } from "@/lib/domain/set-validation";
import { previousCounterpart, previousFor } from "@/lib/domain/comparison";
import { recommendFor, type Recommendation } from "@/lib/domain/progression";
import { isShortOfPlan } from "@/lib/domain/shortfall";
import { compatibleHistory, doneWorkingSets, setDone, setPerformed, sideLabel, sideStream } from "@/lib/domain/sides";
import type { AttachmentRef, ExercisePerformance, ShortfallReason, Side } from "@/lib/domain/types";
import { dismissRecommendation, discardWorkout, finishWorkout, recomputeRecords } from "@/lib/data/mutations";
import type { SessionFull } from "@/lib/data/queries";
import { recentHistory } from "@/lib/data/queries";
import { SyncQueue, type LocalCopy, type SyncOp, type SyncStatus } from "@/lib/data/sync-queue";
import {
  copyLeftToRight, newSet, normalizeSet, patchSide, plannedSets, reconcileSet, removalKind, removeSet, renumber, restoreSet,
  setSideCompleted, switchMode, type RemovedSet, type SidePatch,
} from "@/lib/data/set-rows";
import { toAttachmentRef, toExerciseConfig, toLoggedSet, toPrescription, type AttachmentRow, type ExerciseRow, type ProfileRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";
import { formatDuration, uuid } from "@/lib/utils";
import { AttachmentPicker } from "./attachment-picker";
import { ExerciseCard } from "./exercise-card";
import { ExercisePicker } from "./exercise-picker";
import { RestTimer, type RestState } from "./rest-timer";
import { ShortfallReasonField } from "./shortfall-reason";
import type { WExercise, WSet } from "./types";

interface Props {
  initialSession: SessionFull;
  initialHistory: Record<string, ExercisePerformance[]>;
  library: ExerciseRow[];
  attachments: AttachmentRow[];
  profile: ProfileRow;
  dismissed: string[];
  warmupNotes: string | null;
}

function toWorkout(s: SessionFull): WExercise[] {
  return s.exercises.map((e) => ({
    id: e.id,
    exercise: e.exercise,
    exercise_id: e.exercise_id,
    template_exercise_id: e.template_exercise_id,
    substituted_for: e.substituted_for,
    position: e.position,
    prescribed: e.prescribed ?? {},
    notes: e.notes,
    track_sides: !!e.track_sides,
    attachment_state: e.attachment_state ?? null,
    attachment_id: e.attachment_id ?? null,
    attachment_name: e.attachment_name ?? null,
    sets: e.sets.map(({ session_id: _s, session_exercise_id: _se, ...set }) => normalizeSet(set)),
  }));
}

/** Re-apply writes that were queued locally but never reached the server (crash / closed tab). */
function applyPending(items: WExercise[], ops: SyncOp[], library: ExerciseRow[]): WExercise[] {
  let out = items.map((i) => ({ ...i, sets: [...i.sets] }));
  for (const op of ops) {
    if (op.table === "session_exercises") {
      if (op.kind === "delete") out = out.filter((i) => i.id !== op.id);
      else {
        const row = op.row as Partial<WExercise> & { exercise_id: string };
        const existing = out.find((i) => i.id === op.id);
        const exercise = library.find((l) => l.id === row.exercise_id) ?? existing?.exercise;
        if (!exercise) continue;
        if (existing) Object.assign(existing, row, { exercise });
        else out.push({
          id: op.id, sets: [], template_exercise_id: null, substituted_for: null, notes: null, prescribed: {}, position: 0,
          track_sides: false, attachment_state: null, attachment_id: null, attachment_name: null, ...row, exercise,
        } as WExercise);
      }
    } else if (op.table === "set_logs") {
      const row = op.row as Partial<WSet> & { session_exercise_id?: string };
      for (const i of out) {
        const idx = i.sets.findIndex((s) => s.id === op.id);
        if (op.kind === "delete") {
          if (idx >= 0) i.sets.splice(idx, 1);
        } else if (idx >= 0) {
          i.sets[idx] = { ...i.sets[idx], ...row };
        } else if (row.session_exercise_id === i.id) {
          const { session_exercise_id: _x, ...rest } = row as WSet & { session_exercise_id: string; session_id?: string };
          delete (rest as { session_id?: string }).session_id;
          i.sets.push(normalizeSet(rest as WSet));
        }
      }
    }
  }
  out.sort((a, b) => a.position - b.position);
  out.forEach((i) => i.sets.sort((a, b) => a.position - b.position));
  return out;
}

export function ActiveWorkout({ initialSession, initialHistory, library, attachments: initialAttachments, profile, dismissed: initialDismissed, warmupNotes }: Props) {
  const router = useRouter();
  const db = useMemo(() => createClient(), []);
  const sessionId = initialSession.id;
  const queueRef = useRef<SyncQueue | null>(null);
  const [items, setItems] = useState<WExercise[]>(() => toWorkout(initialSession));
  // Latest items for callbacks that outlive a render (the Undo action of a toast).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [history, setHistory] = useState<Record<string, ExercisePerformance[]>>(initialHistory);
  const [notes, setNotes] = useState(initialSession.notes ?? "");
  const [shortfallReason, setShortfallReason] = useState<ShortfallReason | null>(null);
  const [sync, setSync] = useState<{ status: SyncStatus; pending: number; local: LocalCopy }>({ status: "idle", pending: 0, local: "device" });
  const [rest, setRestState] = useState<RestState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picker, setPicker] = useState<{ mode: "add" } | { mode: "replace"; itemId: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set(initialDismissed));
  const [attachments, setAttachments] = useState(initialAttachments);
  const [attachmentFor, setAttachmentFor] = useState<string | null>(null);
  const unit = profile.unit;
  const restKey = `forma:rest:${sessionId}`;
  // A workout logged for a past day starts well before the row was created. It has no live clock
  // or rest timer, and asks for its duration when saved.
  const startedAt = new Date(initialSession.started_at);
  const backdated = !!initialSession.created_at && new Date(initialSession.created_at).getTime() - startedAt.getTime() > 3600_000;
  const [minutes, setMinutes] = useState("");

  // ---------- autosave queue ----------
  useEffect(() => {
    const q = new SyncQueue(db, `forma:pending:${sessionId}`);
    queueRef.current = q;
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(`forma:pending:${sessionId}`) ?? "[]") as SyncOp[]; } catch { return []; }
    })();
    if (saved.length) {
      setItems((cur) => applyPending(cur, saved, library));
      const n = saved.find((o) => o.table === "workout_sessions" && o.row && "notes" in o.row);
      if (n) setNotes(String(n.row!.notes ?? ""));
      void q.flush();
    }
    const unsub = q.subscribe((status, pending, local) => setSync({ status, pending, local }));
    const onHide = () => { if (document.visibilityState === "hidden") void q.flush(); };
    document.addEventListener("visibilitychange", onHide);
    const beforeUnload = (e: BeforeUnloadEvent) => { if (q.pending > 0) { void q.flush(); e.preventDefault(); } };
    window.addEventListener("beforeunload", beforeUnload);
    try {
      const r = JSON.parse(localStorage.getItem(restKey) ?? "null") as RestState | null;
      if (r && r.endAt > Date.now() - 5000) setRestState(r);
    } catch { /* noop */ }
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", beforeUnload);
      void q.flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, sessionId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const setRest = useCallback((r: RestState | null) => {
    setRestState(r);
    try { if (r) localStorage.setItem(restKey, JSON.stringify(r)); else localStorage.removeItem(restKey); } catch { /* noop */ }
  }, [restKey]);

  const enqueueSet = useCallback((item: WExercise, set: WSet) => {
    queueRef.current?.enqueue({ table: "set_logs", id: set.id, kind: "upsert", row: { ...set, session_id: sessionId, session_exercise_id: item.id } });
  }, [sessionId]);

  const enqueueItem = useCallback((item: WExercise) => {
    // attachment_name is written by the server from the chosen attachment; never sent.
    const { exercise: _e, sets: _s, id, attachment_name: _n, ...row } = item;
    queueRef.current?.enqueue({ table: "session_exercises", id, kind: "upsert", row: { ...row, session_id: sessionId } });
  }, [sessionId]);

  // ---------- recommendations ----------
  const recommendations = useMemo(() => {
    const m = new Map<string, Recommendation>();
    for (const it of items) {
      const cfg = toExerciseConfig(it.exercise);
      m.set(it.id, recommendFor(cfg, toPrescription(it.prescribed, it.exercise), history[it.exercise_id] ?? [],
        { sides: it.track_sides, attachment: toAttachmentRef(it) }, { conservative: profile.progression_conservative }));
    }
    return m;
  }, [items, history, profile.progression_conservative]);

  // ---------- mutations ----------
  function updateItem(itemId: string, fn: (i: WExercise) => WExercise) {
    setItems((cur) => cur.map((i) => (i.id === itemId ? fn(i) : i)));
  }

  function onSetChange(item: WExercise, setId: string, patch: Partial<WSet>) {
    const set = item.sets.find((s) => s.id === setId)!;
    const next = reconcileSet({ ...set, ...patch }, item.exercise.load_type);
    if (set.completed && !next.completed && setProblem(next, item.exercise.load_type)) toast("Set marked incomplete. Fill in the required values and complete it again.");
    updateItem(item.id, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? next : s)) }));
    enqueueSet(item, next);
  }

  function onCompleteSet(item: WExercise, setId: string) {
    const set = item.sets.find((s) => s.id === setId)!;
    if (set.completed) {
      onSetChange(item, setId, { completed: false, completed_at: null });
      return;
    }
    const rec = recommendations.get(item.id);
    const cfg = toExerciseConfig(item.exercise);
    const assisted = cfg.loadType === "assisted";
    const workIdx = item.sets.filter((s) => s.kind === "working").findIndex((s) => s.id === setId);
    const prev = (history[item.exercise_id] ?? [])[0];
    const prevSet = workIdx >= 0 && prev ? previousCounterpart(prev.sets, workIdx, cfg) : null;
    const reps = set.reps ?? (set.kind === "working" ? rec?.targetReps?.[workIdx] ?? prevSet?.reps ?? null : null);
    if (reps == null) {
      toast("Enter reps first");
      return;
    }
    const patch: Partial<WSet> = { completed: true, completed_at: backdated ? initialSession.started_at : new Date().toISOString(), reps };
    if (assisted) {
      patch.assistance_kg = set.assistance_kg ?? (set.kind === "working" ? rec?.targetLoadKg ?? prevSet?.assistanceKg ?? null : null);
      // Missing assistance is not "no assistance": 0 has to be entered explicitly.
      if (patch.assistance_kg == null) {
        toast("Enter the assistance first (0 if none)");
        return;
      }
    } else {
      const bw = cfg.loadType === "bodyweight" || cfg.loadType === "weighted_bodyweight";
      patch.weight_kg = set.weight_kg ?? (set.kind === "working" ? rec?.targetLoadKg ?? prevSet?.weightKg ?? null : null) ?? (bw ? 0 : null);
      if (patch.weight_kg == null) {
        toast("Enter a weight first");
        return;
      }
    }
    const problem = setProblem({ ...set, ...patch }, cfg.loadType);
    if (problem) { toast(problem); return; }
    onSetChange(item, setId, patch);
    if (profile.auto_rest_timer && !backdated && set.kind === "working") {
      const restS = item.prescribed.rest_s ?? item.exercise.default_rest_s ?? profile.default_rest_s;
      if (restS > 0) setRest({ endAt: Date.now() + restS * 1000, duration: restS, label: item.exercise.name });
    }
  }

  // ---------- sides ----------
  function onSideChange(item: WExercise, setId: string, side: Side, patch: SidePatch) {
    const set = item.sets.find((s) => s.id === setId)!;
    const next = patchSide(set, side, patch, item.exercise.load_type);
    if (set[`${side}_completed`] && !next[`${side}_completed`]) toast(`${sideLabel[side]} side marked not done. Fill in the required values and complete it again.`);
    updateItem(item.id, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? next : s)) }));
    enqueueSet(item, next);
  }

  function onCompleteSide(item: WExercise, setId: string, side: Side) {
    const set = item.sets.find((s) => s.id === setId)!;
    const cfg = toExerciseConfig(item.exercise);
    if (set[`${side}_completed`]) {
      const next = setSideCompleted(set, side, false, null, {}, cfg.loadType);
      updateItem(item.id, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? next : s)) }));
      enqueueSet(item, next);
      return;
    }
    // Suggestions for this side only: its own recommendation, then the same side last time.
    const rec = recommendations.get(item.id)?.sides?.[side];
    const sidedIdx = item.sets.filter((s) => s.kind === "working" && s.sided).findIndex((s) => s.id === setId);
    const prev = previousFor(compatibleHistory(history[item.exercise_id] ?? [], toAttachmentRef(item)), side, cfg);
    const prevSet = sidedIdx >= 0 && prev ? previousCounterpart(prev.sets, sidedIdx, cfg) : null;
    const working = set.kind === "working";
    const values: SidePatch = {
      reps: set[`${side}_reps`] ?? (working ? rec?.targetReps?.[sidedIdx] ?? prevSet?.reps ?? null : null),
    };
    if (values.reps == null) { toast(`Enter ${sideLabel[side].toLowerCase()} reps first`); return; }
    if (cfg.loadType === "assisted") {
      values.assistance_kg = set[`${side}_assistance_kg`] ?? (working ? rec?.targetLoadKg ?? prevSet?.assistanceKg ?? null : null);
      if (values.assistance_kg == null) { toast(`Enter the ${sideLabel[side].toLowerCase()} assistance first (0 if none)`); return; }
    } else {
      const bw = cfg.loadType === "bodyweight" || cfg.loadType === "weighted_bodyweight";
      values.weight_kg = set[`${side}_weight_kg`] ?? (working ? rec?.targetLoadKg ?? prevSet?.weightKg ?? null : null) ?? (bw ? 0 : null);
      if (values.weight_kg == null) { toast(`Enter a ${sideLabel[side].toLowerCase()} weight first`); return; }
    }
    const candidate = patchSide(set, side, values, cfg.loadType);
    const problem = setProblem(sideValues(candidate, side), cfg.loadType);
    if (problem) { toast(problem); return; }
    const next = setSideCompleted(candidate, side, true, backdated ? initialSession.started_at : new Date().toISOString(), {}, cfg.loadType);
    updateItem(item.id, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? next : s)) }));
    enqueueSet(item, next);
    // Rest once the pair is done, not between sides.
    if (profile.auto_rest_timer && !backdated && working && setDone(toLoggedSet(next))) {
      const restS = item.prescribed.rest_s ?? item.exercise.default_rest_s ?? profile.default_rest_s;
      if (restS > 0) setRest({ endAt: Date.now() + restS * 1000, duration: restS, label: item.exercise.name });
    }
  }

  function onCopyLeftToRight(item: WExercise, setId: string) {
    const set = item.sets.find((s) => s.id === setId)!;
    const next = copyLeftToRight(set, item.exercise.load_type);
    updateItem(item.id, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? next : s)) }));
    enqueueSet(item, next);
    if (!next.right_completed) toast("Copied to right. Complete the right side when you've done it.");
  }

  function onToggleSides(item: WExercise) {
    const sided = !item.track_sides;
    const r = switchMode(item.sets, sided);
    const next = { ...item, track_sides: sided, sets: r.sets };
    updateItem(item.id, () => next);
    enqueueItem(next);
    r.changed.forEach((s) => enqueueSet(next, s));
    if (r.kept > 0) {
      toast(`${r.kept} set${r.kept === 1 ? "" : "s"} with logged values stay${r.kept === 1 ? "s" : ""} as ${sided ? "logged together" : "logged per side"}. Nothing was discarded.`);
    }
  }

  function onAttachment(item: WExercise, ref: AttachmentRef) {
    const next: WExercise = { ...item, attachment_state: ref.state, attachment_id: ref.id, attachment_name: ref.name };
    updateItem(item.id, () => next);
    enqueueItem(next);
  }

  function onAddSet(item: WExercise, kind: "working" | "warmup") {
    const last = [...item.sets].reverse().find((s) => s.kind === kind) ?? item.sets[item.sets.length - 1];
    const base = newSet(uuid(), { kind, sided: kind === "working" && item.track_sides, from: last });
    let sets: WSet[];
    if (kind === "warmup") {
      const firstWorking = item.sets.findIndex((s) => s.kind === "working");
      sets = [...item.sets];
      sets.splice(firstWorking < 0 ? sets.length : firstWorking, 0, base);
    } else sets = [...item.sets, base];
    sets = sets.map((s, i) => ({ ...s, position: i }));
    const next = { ...item, sets };
    updateItem(item.id, () => next);
    // Persist new set and any re-numbered siblings.
    sets.forEach((s) => {
      const old = item.sets.find((o) => o.id === s.id);
      if (!old || old.position !== s.position) enqueueSet(next, s);
    });
  }

  function onRemoveSet(item: WExercise, setId: string) {
    const meaning = removalKind(item.prescribed, item.sets, setId);
    const { sets, removed } = removeSet(item.sets, setId);
    if (!removed) return;
    updateItem(item.id, (i) => ({ ...i, sets: removeSet(i.sets, setId).sets }));
    queueRef.current?.enqueue({ table: "set_logs", id: setId, kind: "delete" });
    const planned = plannedSets(item.prescribed, item.sets);
    const done = doneWorkingSets(sets.map(toLoggedSet));
    toast(meaning === "planned" ? "Planned set removed" : "Extra set removed", {
      description: meaning === "planned"
        ? `${item.exercise.name}: ${done} of ${planned} planned sets done. The plan is unchanged, so the removed set counts as not done.`
        : undefined,
      duration: 8000,
      action: { label: "Undo", onClick: () => onUndoRemove(item.id, removed) },
    });
  }

  /** Put a removed set back exactly as it was. The delete and this upsert share the row id, so the queue keeps only the latest intent. */
  function onUndoRemove(itemId: string, removed: RemovedSet) {
    const item = itemsRef.current.find((i) => i.id === itemId);
    if (!item) { toast("That exercise was removed, so the set can't be restored."); return; }
    const r = restoreSet(item.sets, removed);
    const next = { ...item, sets: r.sets };
    setItems((cur) => cur.map((i) => (i.id === itemId ? { ...i, sets: restoreSet(i.sets, removed).sets } : i)));
    r.changed.forEach((s) => enqueueSet(next, s));
  }

  function onToggleKind(item: WExercise, setId: string) {
    const s = item.sets.find((x) => x.id === setId)!;
    onSetChange(item, setId, { kind: s.kind === "warmup" ? "working" : "warmup" });
  }

  function onNotes(item: WExercise, value: string) {
    const next = { ...item, notes: value || null };
    updateItem(item.id, () => next);
    enqueueItem(next);
  }

  function onMove(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const arr = [...items];
    [arr[index], arr[j]] = [arr[j], arr[index]];
    const renumbered = arr.map((it, k) => ({ ...it, position: k }));
    setItems(renumbered);
    renumbered.forEach((it, k) => { if (items[k]?.id !== it.id) enqueueItem(it); });
  }

  function onRemove(item: WExercise) {
    const logged = item.sets.some((s) => s.completed);
    if (logged && !confirm(`Remove ${item.exercise.name} and its logged sets from this workout?`)) return;
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    queueRef.current?.enqueue({ table: "session_exercises", id: item.id, kind: "delete" });
  }

  async function loadHistoryFor(exerciseId: string) {
    if (history[exerciseId]) return;
    try {
      const h = await recentHistory(db, [exerciseId], 6, sessionId);
      setHistory((cur) => ({ ...cur, [exerciseId]: h.byExercise.get(exerciseId) ?? [] }));
    } catch {
      /* comparison simply unavailable */
    }
  }

  function onPick(ex: ExerciseRow) {
    if (!picker) return;
    if (picker.mode === "add") {
      const item: WExercise = {
        id: uuid(), exercise: ex, exercise_id: ex.id, template_exercise_id: null, substituted_for: null,
        position: items.length,
        prescribed: { sets: ex.default_sets, rep_min: ex.default_rep_min, rep_max: ex.default_rep_max, rest_s: ex.default_rest_s },
        notes: null,
        track_sides: ex.track_sides,
        attachment_state: ex.default_attachment_state,
        attachment_id: ex.default_attachment_id,
        attachment_name: attachments.find((a) => a.id === ex.default_attachment_id)?.name ?? null,
        sets: Array.from({ length: ex.default_sets }, (_, i) => ({ ...newSet(uuid(), { kind: "working", sided: ex.track_sides }), position: i })),
      };
      // An archived default isn't offered for new workouts.
      if (item.attachment_id && !attachments.some((a) => a.id === item.attachment_id && !a.archived_at)) {
        Object.assign(item, { attachment_state: null, attachment_id: null, attachment_name: null });
      }
      setItems((cur) => [...cur, item]);
      enqueueItem(item);
      item.sets.forEach((s) => enqueueSet(item, s));
      setTimeout(() => document.getElementById(`ex-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } else {
      const old = items.find((i) => i.id === picker.itemId)!;
      if (old.sets.some((s) => s.completed)) {
        toast("This exercise already has logged sets. Add the new exercise instead, so your history stays accurate.");
        return;
      }
      const next: WExercise = {
        ...old, exercise: ex, exercise_id: ex.id, substituted_for: old.substituted_for ?? old.exercise_id,
        sets: old.sets.map((s) => ({ ...newSet(s.id, { kind: s.kind, sided: s.sided }), position: s.position })),
      };
      updateItem(old.id, () => next);
      enqueueItem(next);
      next.sets.forEach((s) => enqueueSet(next, s));
    }
    void loadHistoryFor(ex.id);
  }

  function onSessionNotes(v: string) {
    setNotes(v);
    queueRef.current?.enqueue({ table: "workout_sessions", id: sessionId, kind: "upsert", row: { notes: v || null } });
  }

  async function onDismiss(item: WExercise) {
    const rec = recommendations.get(item.id);
    if (!rec) return;
    const key = `progression:${item.exercise_id}`;
    setDismissed((d) => new Set(d).add(`${key}:${rec.evidenceSessionId ?? ""}`));
    try { await dismissRecommendation(db, key, rec.evidenceSessionId); } catch { /* local dismissal still applies */ }
  }

  // ---------- finish / discard ----------
  const counts = useMemo(() => {
    let done = 0, open = 0, partial = 0, planned = 0, plannedDone = 0;
    for (const i of items) {
      const logged = i.sets.map(toLoggedSet);
      for (const s of logged) {
        if (setDone(s)) done++;
        else if (setPerformed(s)) partial++;
        else open++;
      }
      // Progress counts planned working sets; removing a planned set never makes the workout look finished.
      const p = plannedSets(i.prescribed, i.sets);
      planned += p;
      plannedDone += Math.min(p, doneWorkingSets(logged));
    }
    return { done, open, partial, planned, plannedDone };
  }, [items]);
  const shortOfPlan = useMemo(
    () => items.some((i) => isShortOfPlan(i.prescribed, doneWorkingSets(i.sets.map(toLoggedSet)))),
    [items],
  );
  /** The set to do next: the first one not done, in workout order. */
  const activeSetId = useMemo(() => {
    for (const i of items) for (const s of i.sets) if (!setDone(toLoggedSet(s))) return s.id;
    return null;
  }, [items]);

  async function finish() {
    for (const item of items) for (const set of item.sets) {
      if (!set.completed) continue;
      const problems = set.sided
        ? (["left", "right"] as Side[]).filter((sd) => set[`${sd}_completed`]).map((sd) => setProblem(sideValues(set, sd), item.exercise.load_type))
        : [setProblem(set, item.exercise.load_type)];
      const problem = problems.find(Boolean);
      if (problem) { toast.error(`${item.exercise.name}: ${problem}`); return; }
    }
    setBusy(true);
    try {
      const q = queueRef.current!;
      for (let i = 0; i < 5 && !(await q.flush()); i++) await new Promise((r) => setTimeout(r, 800));
      if (q.pending > 0) {
        throw new Error(q.local === "device"
          ? "Couldn't reach the server. Your sets are saved on this device — try again when you're online."
          : "Couldn't reach the server, and this device couldn't store your sets. Keep this page open and try again when you're online.");
      }
      const mins = Number(minutes);
      await finishWorkout(db, sessionId, notes || null, backdated ? new Date(startedAt.getTime() + (mins > 0 ? mins : estMinutes) * 60000) : new Date(), shortOfPlan ? shortfallReason : null);
      const exs = [...new Map(items.filter((i) => i.sets.some((s) => s.completed)).map((i) => [i.exercise_id, i.exercise])).values()];
      try {
        await recomputeRecords(db, exs);
      } catch (e) {
        console.error(e);
        toast.error("Workout saved, but personal records couldn't be updated. They'll update the next time you save a workout with these exercises.");
      }
      try { localStorage.removeItem(restKey); } catch { /* noop */ }
      router.replace(`/workout/${sessionId}/summary`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  async function discard() {
    if (!confirm("Discard this workout? Logged sets will be deleted.")) return;
    setBusy(true);
    try {
      await discardWorkout(db, sessionId);
      try { localStorage.removeItem(`forma:pending:${sessionId}`); localStorage.removeItem(restKey); } catch { /* noop */ }
      router.replace("/");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const elapsed = now - startedAt.getTime();
  // ~40 s per completed set plus its prescribed rest
  const estMinutes = Math.max(10, Math.round(items.reduce((a, i) => a + i.sets.filter((x) => x.completed).length * (40 + (i.prescribed.rest_s ?? profile.default_rest_s)), 0) / 60));
  const pickerItem = items.find((i) => i.id === attachmentFor) ?? null;

  return (
    <div className="min-h-dvh pb-40">
      {/* Header */}
      <header className="pt-safe sticky top-0 z-30 border-b bg-sidebar/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-2 md:px-4">
          <Link href="/" aria-label="Back to dashboard" className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <ChevronLeft className="size-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold leading-tight tracking-[-0.02em]">{initialSession.name}</p>
            <p className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[12px] text-muted-foreground tabular">
              {backdated ? <span>Logging for {format(startedAt, "EEE d MMM")}</span> : <span suppressHydrationWarning className="font-semibold text-foreground">{formatDuration(elapsed)}</span>}
              {counts.planned > 0 && <span>· <span className="font-semibold text-done">{counts.plannedDone}</span>/{counts.planned}<span className="max-[359px]:sr-only"> sets</span></span>}
              <span aria-live="polite" className="flex items-center gap-1">
                ·{" "}
                {sync.status === "saving" ? (<><Loader2 className="size-3 animate-spin" /> <span className="max-[359px]:sr-only">Saving</span></>)
                  : sync.pending === 0 ? (<><Cloud className="size-3" /> <span className="max-[359px]:sr-only">Saved</span></>)
                  : sync.local === "device" ? (<span className="flex items-center gap-1 text-negative"><CloudOff className="size-3" /> Saved on device · retrying</span>)
                  : (<span className="flex items-center gap-1 text-negative"><CloudOff className="size-3" /> Not saved yet · keep page open</span>)}
              </span>
            </p>
          </div>
          {!backdated && (
            <button
              aria-label="Start rest timer"
              onClick={() => setRest({ endAt: Date.now() + profile.default_rest_s * 1000, duration: profile.default_rest_s, label: "Manual" })}
              className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <Timer className="size-[18px]" />
            </button>
          )}
          <Menu>
            <MenuTrigger aria-label="Workout options" className="grid size-10 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted">
              <MoreHorizontal className="size-5" />
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setPicker({ mode: "add" })}><Plus /> Add exercise</MenuItem>
              <MenuItem destructive onSelect={discard}><Trash2 /> Discard workout</MenuItem>
            </MenuContent>
          </Menu>
          <Button variant="primary" size="sm" className="ml-1 h-9 px-4" onClick={() => setFinishing(true)} disabled={busy}>
            {backdated ? "Save" : "Finish"}
          </Button>
        </div>
        {counts.planned > 0 && (
          <div
            role="progressbar" aria-label="Planned sets done" aria-valuemin={0} aria-valuemax={counts.planned} aria-valuenow={counts.plannedDone}
            className="h-1 bg-subtle"
          >
            <div className="h-full rounded-r-full bg-done transition-[width] duration-300" style={{ width: `${(100 * counts.plannedDone) / counts.planned}%` }} />
          </div>
        )}
      </header>

      <div className="mx-auto max-w-2xl space-y-3 px-3 pt-4 md:px-4">
        {warmupNotes && items.every((i) => i.sets.every((s) => !s.completed)) && (
          <p className="rounded-lg border border-dashed border-input bg-muted/40 px-4 py-3 text-[13.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">Warm-up</span> · {warmupNotes}
          </p>
        )}
        {items.map((item, idx) => {
          const rec = recommendations.get(item.id) ?? null;
          const key = `progression:${item.exercise_id}:${rec?.evidenceSessionId ?? ""}`;
          return (
            <div id={`ex-${item.id}`} key={item.id} className="scroll-mt-20">
              <ExerciseCard
                item={item}
                config={toExerciseConfig(item.exercise)}
                history={history[item.exercise_id] ?? []}
                recommendation={rec}
                recommendationDismissed={dismissed.has(key)}
                unit={unit}
                isFirst={idx === 0}
                isLast={idx === items.length - 1}
                activeSetId={activeSetId}
                onSetChange={(id, patch) => onSetChange(item, id, patch)}
                onSideChange={(id, side, patch) => onSideChange(item, id, side, patch)}
                onCompleteSide={(id, side) => onCompleteSide(item, id, side)}
                onCopyLeftToRight={(id) => onCopyLeftToRight(item, id)}
                onToggleSides={() => onToggleSides(item)}
                onPickAttachment={() => setAttachmentFor(item.id)}
                onCompleteSet={(id) => onCompleteSet(item, id)}
                onAddSet={(k) => onAddSet(item, k)}
                onRemoveSet={(id) => onRemoveSet(item, id)}
                onToggleKind={(id) => onToggleKind(item, id)}
                onNotes={(v) => onNotes(item, v)}
                onMove={(d) => onMove(idx, d)}
                onRemove={() => onRemove(item)}
                onReplace={() => setPicker({ mode: "replace", itemId: item.id })}
                onDismissRecommendation={() => onDismiss(item)}
              />
            </div>
          );
        })}

        <Button variant="outline" size="lg" className="w-full" onClick={() => setPicker({ mode: "add" })}>
          <Plus /> Add exercise
        </Button>

        <div className="pt-4">
          <label className="mb-1.5 block px-1 text-[15px] font-semibold tracking-tight" htmlFor="session-notes">Workout notes</label>
          <Textarea id="session-notes" value={notes} onChange={(e) => onSessionNotes(e.target.value)} placeholder="Sleep, energy, anything worth remembering…" />
        </div>
      </div>

      <RestTimer rest={rest} onChange={setRest} sound={profile.rest_sound} />

      <AttachmentPicker
        open={pickerItem != null}
        onOpenChange={(o) => !o && setAttachmentFor(null)}
        title={pickerItem ? `Attachment · ${pickerItem.exercise.name}` : "Attachment"}
        value={pickerItem ? toAttachmentRef(pickerItem) : null}
        attachments={attachments}
        onListChange={setAttachments}
        onChange={(ref) => pickerItem && onAttachment(pickerItem, ref)}
      />

      <ExercisePicker
        open={picker != null}
        onOpenChange={(o) => !o && setPicker(null)}
        exercises={library}
        title={picker?.mode === "replace" ? "Replace exercise" : "Add exercise"}
        onPick={onPick}
      />

      <Sheet open={finishing} onOpenChange={setFinishing}>
        <SheetContent
          title={backdated ? "Save workout?" : "Finish workout?"}
          description={`${backdated ? format(startedAt, "EEEE d MMMM") : formatDuration(elapsed)} · ${counts.done} set${counts.done === 1 ? "" : "s"} completed`}
        >
          {backdated && (
            <div className="mb-4 space-y-1.5">
              <Label htmlFor="duration">How long did it take? (minutes)</Label>
              <Input id="duration" inputMode="numeric" pattern="[0-9]*" placeholder={String(estMinutes)} value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              <p className="text-[12px] text-muted-foreground">Leave empty to use the estimate of {estMinutes} min. You can change it later in History.</p>
            </div>
          )}
          {(counts.open > 0 || counts.partial > 0) && (
            <p className="mb-4 rounded-md bg-muted px-3 py-2.5 text-[13.5px] text-muted-foreground">
              {counts.open > 0 && `${counts.open} set${counts.open === 1 ? "" : "s"} not marked complete will be left out of the record. `}
              {counts.partial > 0 && `${counts.partial} set${counts.partial === 1 ? " has" : "s have"} only one side done; the other side is recorded as not performed.`}
            </p>
          )}
          {shortOfPlan && counts.done > 0 && (
            <div className="mb-4"><ShortfallReasonField value={shortfallReason} onChange={setShortfallReason} /></div>
          )}
          {counts.done === 0 && <p className="mb-4 text-[13.5px] text-muted-foreground">No completed sets yet. You can discard the workout instead.</p>}
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" onClick={finish} disabled={busy || counts.done === 0}>
              {busy && <Loader2 className="animate-spin" />} {backdated ? "Save workout" : "Finish & save"}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setFinishing(false)}>{backdated ? "Keep editing" : "Keep training"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

