"use client";
import { format } from "date-fns";
import { ArrowUpDown, ChevronLeft, Cloud, CloudOff, Footprints, Gauge, Loader2, MoreHorizontal, Plus, Timer, Trash2 } from "lucide-react";
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
import { planCopy, type SetValues } from "@/lib/domain/previous-copy";
import { adjustRest as adjustRestState, restFor, restoreRest, setRestLength, startRest } from "@/lib/domain/rest";
import { planSwap } from "@/lib/domain/substitution";
import { recommendFor, type Recommendation } from "@/lib/domain/progression";
import { isShortOfPlan } from "@/lib/domain/shortfall";
import { compatibleHistory, doneWorkingSets, setDone, setPerformed, sideLabel, sideStream } from "@/lib/domain/sides";
import type { AttachmentRef, ExercisePerformance, ShortfallReason, Side } from "@/lib/domain/types";
import { dismissRecommendation, discardWorkout, finishWorkout, recomputeRecords, restoreTemplateExercise, swapTemplateExercise } from "@/lib/data/mutations";
import type { SessionFull } from "@/lib/data/queries";
import { recentHistory, sessionExerciseOrder } from "@/lib/data/queries";
import { SyncQueue, type LocalCopy, type SyncOp, type SyncStatus } from "@/lib/data/sync-queue";
import {
  addDropSegment, canToggleKind, copyLeftToRight, dropSegmentsOf, newSet, normalizeSet, orderSets, patchSide, plannedSets, reconcileSet,
  plannedForProgress, removalKind, removeSet, restoreSet, setSideCompleted, switchMode, type RemovedSet, type SidePatch,
} from "@/lib/data/set-rows";
import {
  distanceUnit, normalizeRun, toAttachmentRef, toExerciseConfig, toLoggedSet, toPrescription, type AttachmentRow, type ExerciseRow, type ProfileRow,
  type PrescribedJson, type SessionRunRow, type SwapInfo,
} from "@/lib/data/types";
import { runProblem } from "@/lib/domain/running";
import { restTrigger } from "@/lib/data/rest-rules";
import { moveInOrder, repositioned, workoutOrder } from "@/lib/data/workout-order";
import { createClient } from "@/lib/supabase/client";
import { formatDuration, uuid } from "@/lib/utils";
import { AttachmentPicker } from "./attachment-picker";
import { EnergySheet } from "./energy-rating";
import { ExerciseCard } from "./exercise-card";
import { ExercisePicker } from "./exercise-picker";
import { RestChip, RestTimer, unlockRestSound, useKeyboardOpen, type NextUp, type RestAlerts, type RestLengthInfo, type RestState } from "./rest-timer";
import { SwapSheet, type SwapChoice } from "./swap-sheet";
import { RunCard, type RunPatch } from "./run-card";
import { ReorderList, type ReorderEntry } from "./reorder-list";
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
    sets: orderSets(e.sets.map(({ session_id: _s, session_exercise_id: _se, ...set }) => normalizeSet(set))),
  }));
}

/** Re-apply queued run writes that never reached the server. */
function applyPendingRuns(runs: SessionRunRow[], ops: SyncOp[], sessionId: string): SessionRunRow[] {
  let out = [...runs];
  for (const op of ops) {
    if (op.table !== "session_runs") continue;
    if (op.kind === "delete") { out = out.filter((r) => r.id !== op.id); continue; }
    const i = out.findIndex((r) => r.id === op.id);
    if (i >= 0) out[i] = normalizeRun({ ...out[i], ...(op.row as Partial<SessionRunRow>) });
    else out.push(normalizeRun({ ...emptyRun(op.id, sessionId, 0), ...(op.row as Partial<SessionRunRow>) }));
  }
  return out.sort((a, b) => a.position - b.position);
}

function emptyRun(id: string, sessionId: string, position: number): SessionRunRow {
  return {
    id, session_id: sessionId, template_run_id: null, position, name: "Run", prescribed: {}, setting: null, duration_s: null,
    distance_m: null, effort: null, intervals_done: null, notes: null, completed: false, completed_at: null,
  };
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
  out.forEach((i) => { i.sets.sort((a, b) => a.position - b.position); i.sets = orderSets(i.sets); });
  return out;
}

export function ActiveWorkout({ initialSession, initialHistory, library, attachments: initialAttachments, profile, dismissed: initialDismissed, warmupNotes }: Props) {
  const router = useRouter();
  const db = useMemo(() => createClient(), []);
  const sessionId = initialSession.id;
  const queueRef = useRef<SyncQueue | null>(null);
  const [items, setItems] = useState<WExercise[]>(() => toWorkout(initialSession));
  const [runs, setRuns] = useState<SessionRunRow[]>(() => (initialSession.runs ?? []).map(normalizeRun));
  const distUnit = distanceUnit(profile);
  // Latest items for callbacks that outlive a render (the Undo action of a toast).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const runsRef = useRef(runs);
  runsRef.current = runs;
  // Reorder mode: null when off, else the entry to focus when it opens.
  const [reorder, setReorder] = useState<{ focusId: string | null } | null>(null);
  const lastMovedRef = useRef<string | null>(null);
  const openingReorderRef = useRef(false);
  const [history, setHistory] = useState<Record<string, ExercisePerformance[]>>(initialHistory);
  const [notes, setNotes] = useState(initialSession.notes ?? "");
  const [shortfallReason, setShortfallReason] = useState<ShortfallReason | null>(null);
  const [energy, setEnergy] = useState<number | null>(initialSession.energy_rating ?? null);
  const [editingEnergy, setEditingEnergy] = useState(false);
  const [sync, setSync] = useState<{ status: SyncStatus; pending: number; local: LocalCopy }>({ status: "idle", pending: 0, local: "device" });
  const [rest, setRestState] = useState<RestState | null>(null);
  // The latest rest for handlers that run faster than a render (rapid +15 / −15 taps).
  const restRef = useRef<RestState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picker, setPicker] = useState<{ mode: "add" } | null>(null);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  // Exercises seen in this workout, so an undo can restore one even if it isn't in the library list.
  const seenExercises = useRef(new Map<string, ExerciseRow>(initialSession.exercises.map((e) => [e.exercise_id, e.exercise])));
  // Rest lengths changed for this workout only (session exercise id → seconds). Never written to the program.
  const overrideKey = `forma:rest-override:${sessionId}`;
  const [restOverrides, setRestOverrides] = useState<Record<string, number>>({});
  const [alerts, setAlertsState] = useState<RestAlerts>({ sound: profile.rest_sound, vibrate: true });
  const [betweenSides, setBetweenSidesState] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  // Where each exercise was in earlier sessions (session id → exercise ids in order), for context.
  const [prevOrder, setPrevOrder] = useState<Record<string, string[]>>({});
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
      setRuns((cur) => applyPendingRuns(cur, saved, sessionId));
      const n = saved.find((o) => o.table === "workout_sessions" && o.row && "notes" in o.row);
      if (n) setNotes(String(n.row!.notes ?? ""));
      const en = saved.find((o) => o.table === "workout_sessions" && o.row && "energy_rating" in o.row);
      if (en) setEnergy((en.row!.energy_rating as number | null) ?? null);
      void q.flush();
    }
    const unsub = q.subscribe((status, pending, local) => setSync({ status, pending, local }));
    const onHide = () => { if (document.visibilityState === "hidden") void q.flush(); };
    document.addEventListener("visibilitychange", onHide);
    const beforeUnload = (e: BeforeUnloadEvent) => { if (q.pending > 0) { void q.flush(); e.preventDefault(); } };
    window.addEventListener("beforeunload", beforeUnload);
    try {
      // The deadline is stored, so a reload or a return from the background shows the true time left.
      const r = restoreRest(JSON.parse(localStorage.getItem(restKey) ?? "null"), Date.now());
      restRef.current = r;
      setRestState(r);
      if (!r) localStorage.removeItem(restKey);
      setRestOverrides(JSON.parse(localStorage.getItem(overrideKey) ?? "{}") ?? {});
      const a = JSON.parse(localStorage.getItem("forma:rest-alerts") ?? "null") as RestAlerts | null;
      if (a && typeof a.sound === "boolean") setAlertsState({ sound: a.sound, vibrate: a.vibrate !== false });
      setBetweenSidesState(localStorage.getItem("forma:rest-between-sides") === "1");
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
    restRef.current = r;
    setRestState(r);
    try { if (r) localStorage.setItem(restKey, JSON.stringify(r)); else localStorage.removeItem(restKey); } catch { /* noop */ }
  }, [restKey]);
  const clearRest = useCallback(() => setRest(null), [setRest]);

  /** Each tap builds on the stored deadline, so fast taps all count and never fight each other. */
  function onAdjustRest(deltaS: number) {
    const r = restRef.current;
    if (r) setRest(adjustRestState(r, deltaS, Date.now()));
  }

  function setAlerts(a: RestAlerts) {
    setAlertsState(a);
    try { localStorage.setItem("forma:rest-alerts", JSON.stringify(a)); } catch { /* noop */ }
  }

  function setBetweenSides(on: boolean) {
    setBetweenSidesState(on);
    try { localStorage.setItem("forma:rest-between-sides", on ? "1" : "0"); } catch { /* noop */ }
  }

  /** The rest for an exercise: this workout's override, else its prescription, the exercise's default, the profile's. */
  function restOf(item: WExercise) {
    return restFor({ overrideS: restOverrides[item.id], prescribedS: item.prescribed.rest_s, exerciseS: item.exercise.default_rest_s, profileS: profile.default_rest_s });
  }

  /** Change this workout's rest for one exercise (or go back to the planned rest). The running rest follows it. */
  function onRestLength(itemId: string, seconds: number | null) {
    const next = { ...restOverrides };
    if (seconds == null) delete next[itemId]; else next[itemId] = seconds;
    setRestOverrides(next);
    try { localStorage.setItem(overrideKey, JSON.stringify(next)); } catch { /* noop */ }
    const r = restRef.current;
    const item = items.find((i) => i.id === itemId);
    if (r && r.itemId === itemId && item) {
      const planned = restFor({ prescribedS: item.prescribed.rest_s, exerciseS: item.exercise.default_rest_s, profileS: profile.default_rest_s });
      setRest(setRestLength(r, seconds ?? planned.seconds, Date.now(), seconds == null ? planned.source : "override"));
    }
  }

  const enqueueSet = useCallback((item: WExercise, set: WSet) => {
    // Only drop segments carry drop_parent_id, so sets without drops also save before migration 013.
    const { drop_parent_id, ...row } = set;
    queueRef.current?.enqueue({
      table: "set_logs", id: set.id, kind: "upsert",
      row: { ...row, ...(drop_parent_id ? { drop_parent_id } : {}), session_id: sessionId, session_exercise_id: item.id },
    });
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

  /**
   * Normal rest after a set is done. A drop set rests once, after its last segment: no timer starts
   * between the working set and its drops or between drops.
   */
  function restAfter(item: WExercise, sets: WSet[], setId: string, side?: Side) {
    if (!profile.auto_rest_timer || backdated) return;
    const trigger = restTrigger(sets, setId, { side, betweenSides });
    if (trigger === "none") return;
    const { seconds, source } = restOf(item);
    if (seconds > 0) {
      setRest(startRest(seconds, Date.now(), { label: item.exercise.name, itemId: item.id, source, betweenSides: trigger === "between_sides" }));
    }
  }

  /** A drop needs its working set (that side, when sides are tracked) done first. Returns the problem, or null. */
  function dropBlocked(item: WExercise, set: WSet, side?: Side): string | null {
    if (set.kind !== "drop") return null;
    const parent = item.sets.find((x) => x.id === set.drop_parent_id);
    const n = item.sets.filter((x) => x.kind === "working").findIndex((x) => x.id === parent?.id) + 1;
    if (!parent) return null;
    if (side && parent.sided ? !parent[`${side}_completed`] : !parent.completed) {
      return `Complete ${side && parent.sided ? `the ${sideLabel[side].toLowerCase()} side of ` : ""}set ${n} before its drop.`;
    }
    return null;
  }

  function onSetChange(item: WExercise, setId: string, patch: Partial<WSet>) {
    const set = item.sets.find((s) => s.id === setId)!;
    const next = reconcileSet({ ...set, ...patch }, item.exercise.load_type);
    if (set.completed && !next.completed && setProblem(next, item.exercise.load_type)) toast("Set marked incomplete. Fill in the required values and complete it again.");
    if (set.completed && !next.completed && dropSegmentsOf(item.sets, setId).some((d) => d.completed)) {
      toast("Its drops stay logged. Complete this set again before finishing, or remove the drops.");
    }
    updateItem(item.id, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? next : s)) }));
    enqueueSet(item, next);
  }

  function onCompleteSet(item: WExercise, setId: string) {
    const set = item.sets.find((s) => s.id === setId)!;
    if (set.completed) {
      onSetChange(item, setId, { completed: false, completed_at: null });
      return;
    }
    const blocked = dropBlocked(item, set);
    if (blocked) { toast(blocked); return; }
    const rec = recommendations.get(item.id);
    const cfg = toExerciseConfig(item.exercise);
    const assisted = cfg.loadType === "assisted";
    const workIdx = item.sets.filter((s) => s.kind === "working").findIndex((s) => s.id === setId);
    // Prefill from the same position of the same stream in a compatible session; never another position.
    const togetherIdx = item.sets.filter((s) => s.kind === "working" && !s.sided).findIndex((s) => s.id === setId);
    const prev = previousFor(compatibleHistory(history[item.exercise_id] ?? [], toAttachmentRef(item)), "together", cfg);
    const prevSet = togetherIdx >= 0 && prev ? previousCounterpart(prev.sets, togetherIdx, cfg) : null;
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
    restAfter(item, item.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)), setId);
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
    const blocked = dropBlocked(item, set, side);
    if (blocked) { toast(blocked); return; }
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
    // Rest once the pair is done; between the sides only when the user turned that on.
    restAfter(item, item.sets.map((s) => (s.id === setId ? next : s)), setId, side);
  }

  function onCopyLeftToRight(item: WExercise, setId: string) {
    const set = item.sets.find((s) => s.id === setId)!;
    const next = copyLeftToRight(set, item.exercise.load_type);
    updateItem(item.id, (i) => ({ ...i, sets: i.sets.map((s) => (s.id === setId ? next : s)) }));
    enqueueSet(item, next);
    if (!next.right_completed) toast("Copied to right. Complete the right side when you've done it.");
  }

  /**
   * Copy the matched previous set's values into a set (or one side of it). Fills empty fields only and
   * never completes the set; values already entered are replaced only through the toast's explicit action.
   */
  function onCopyPrevious(itemId: string, setId: string, side: Side | null, previous: SetValues) {
    const fresh = () => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      const set = item?.sets.find((x) => x.id === setId);
      return item && set ? { item, set } : null;
    };
    const cur = fresh();
    if (!cur) return;
    const assisted = cur.item.exercise.load_type === "assisted";
    const valuesOf = (st: WSet): SetValues => side
      ? { load: assisted ? st[`${side}_assistance_kg`] : st[`${side}_weight_kg`], reps: st[`${side}_reps`], rir: st[`${side}_rir`] }
      : { load: assisted ? st.assistance_kg : st.weight_kg, reps: st.reps, rir: st.rir };
    const apply = (v: Partial<SetValues>) => {
      const now = fresh();
      if (!now) return;
      const patch: SidePatch = {};
      if (v.load !== undefined) patch[assisted ? "assistance_kg" : "weight_kg"] = v.load;
      if (v.reps !== undefined) patch.reps = v.reps;
      if (v.rir !== undefined) patch.rir = v.rir;
      if (side) onSideChange(now.item, setId, side, patch);
      else onSetChange(now.item, setId, patch as Partial<WSet>);
    };
    const plan = planCopy(valuesOf(cur.set), previous, { includeRir: previous.rir != null });
    if (plan.same) { toast("Already the same as last time."); return; }
    if (Object.keys(plan.fill).length) apply(plan.fill);
    const conflicts = Object.keys(plan.conflicts) as (keyof SetValues)[];
    if (conflicts.length) {
      const names = conflicts.map((f) => (f === "load" ? (assisted ? "assistance" : "load") : f === "rir" ? "RIR" : "reps"));
      toast(`Kept the ${names.join(" and ")} you entered.`, {
        description: "Nothing was overwritten. The set isn't marked done.",
        duration: 7000,
        action: { label: "Use last time's", onClick: () => apply(plan.conflicts) },
      });
    }
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

  function onAddDrop(item: WExercise, parentId: string) {
    const r = addDropSegment(item.sets, parentId, uuid());
    if (!r) return;
    const next = { ...item, sets: r.sets };
    updateItem(item.id, () => next);
    r.changed.forEach((s) => enqueueSet(next, s));
    // The sequence continues: the rest that started with the working set waits until the last drop.
    if (restRef.current?.itemId === item.id) setRest(null);
  }

  function onRemoveSet(item: WExercise, setId: string) {
    const meaning = removalKind(item.prescribed, item.sets, setId);
    const { sets, removed } = removeSet(item.sets, setId);
    if (!removed) return;
    updateItem(item.id, (i) => ({ ...i, sets: removeSet(i.sets, setId).sets }));
    for (const s of [removed.set, ...(removed.segments ?? [])]) queueRef.current?.enqueue({ table: "set_logs", id: s.id, kind: "delete" });
    const planned = plannedSets(item.prescribed, item.sets);
    const done = doneWorkingSets(sets.map(toLoggedSet));
    const drops = removed.segments?.length ?? 0;
    const title = meaning === "planned" ? "Planned set removed" : meaning === "drop" ? "Drop removed" : meaning === "warmup" ? "Warm-up removed" : "Extra set removed";
    toast(drops ? `${title} with ${drops} drop${drops === 1 ? "" : "s"}` : title, {
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

  /** Warm-up ⇄ working. Logged values and completion are kept as they are. */
  function onToggleKind(item: WExercise, setId: string) {
    const s = item.sets.find((x) => x.id === setId)!;
    if (!canToggleKind(item.sets, setId)) { toast("Remove this set's drops before marking it as a warm-up."); return; }
    onSetChange(item, setId, { kind: s.kind === "warmup" ? "working" : "warmup" });
  }

  function onNotes(item: WExercise, value: string) {
    const next = { ...item, notes: value || null };
    updateItem(item.id, () => next);
    enqueueItem(next);
  }

  /**
   * Move an exercise or a run one place in the workout. Exercises and runs share one order.
   * Only positions change, for this session only (the program's order is untouched). Reads and
   * updates the refs so taps faster than a render each build on the previous move; the autosave
   * queue keeps one pending write per row and writes in sequence, so the newest order wins.
   */
  function onMove(id: string, dir: -1 | 1) {
    const curItems = itemsRef.current, curRuns = runsRef.current;
    const pos = moveInOrder(workoutOrder(curItems, curRuns), id, dir);
    if (!pos) return;
    const movedItems = repositioned(curItems, pos);
    const movedRuns = repositioned(curRuns, pos);
    const nextItems = curItems.map((it) => movedItems.find((m) => m.id === it.id) ?? it).sort((a, b) => a.position - b.position);
    const nextRuns = curRuns.map((r) => movedRuns.find((m) => m.id === r.id) ?? r).sort((a, b) => a.position - b.position);
    itemsRef.current = nextItems;
    runsRef.current = nextRuns;
    lastMovedRef.current = id;
    setItems(nextItems);
    setRuns(nextRuns);
    movedItems.forEach(enqueueItem);
    movedRuns.forEach(enqueueRun);
  }

  function reorderEntries(): ReorderEntry[] {
    return workoutOrder(items, runs).map((e) => {
      if (e.kind === "run") {
        const r = runs.find((x) => x.id === e.id)!;
        return { id: r.id, kind: "run", name: r.name, detail: r.completed ? "Run · done" : "Run" };
      }
      const it = items.find((x) => x.id === e.id)!;
      const working = it.sets.filter((x) => x.kind === "working");
      const done = working.filter((x) => x.completed).length;
      const detail = working.length === 0 ? "No sets yet" : done > 0 ? `${done}/${working.length} sets done` : `${working.length} set${working.length === 1 ? "" : "s"}`;
      return { id: it.id, kind: "exercise", name: it.exercise.name, detail };
    });
  }

  function closeReorder() {
    const id = lastMovedRef.current ?? reorder?.focusId ?? null;
    setReorder(null);
    lastMovedRef.current = null;
    void queueRef.current?.flush();
    // Back in the workout, bring the last moved entry (or the one the mode was opened from) into view.
    if (id) requestAnimationFrame(() => (document.getElementById(`ex-${id}`) ?? document.getElementById(`run-${id}`))?.scrollIntoView({ block: "start" }));
  }

  // ---------- runs ----------
  function enqueueRun(r: SessionRunRow) {
    const { id, ...row } = r;
    queueRef.current?.enqueue({ table: "session_runs", id, kind: "upsert", row: { ...row, session_id: sessionId } });
  }

  function nextPosition() {
    return Math.max(-1, ...items.map((i) => i.position), ...runs.map((r) => r.position)) + 1;
  }

  function onAddRun() {
    const r = emptyRun(uuid(), sessionId, nextPosition());
    setRuns((cur) => [...cur, r]);
    enqueueRun(r);
    setTimeout(() => document.getElementById(`run-${r.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function onRunChange(id: string, patch: RunPatch) {
    const cur = runs.find((r) => r.id === id);
    if (!cur) return;
    let next = { ...cur, ...patch };
    // A done run that no longer has valid values goes back to not done; nothing is saved as done with bad values.
    if (next.completed && runProblem(next)) {
      next = { ...next, completed: false, completed_at: null };
      toast("Run marked not done. Fix the time or distance and mark it done again.");
    }
    setRuns((all) => all.map((r) => (r.id === id ? next : r)));
    enqueueRun(next);
  }

  function onCompleteRun(id: string) {
    const cur = runs.find((r) => r.id === id);
    if (!cur) return;
    if (cur.completed) { const n = { ...cur, completed: false, completed_at: null }; setRuns((all) => all.map((r) => (r.id === id ? n : r))); enqueueRun(n); return; }
    const problem = runProblem(cur);
    if (problem) { toast(problem); return; }
    const next = { ...cur, completed: true, completed_at: backdated ? initialSession.started_at : new Date().toISOString() };
    setRuns((all) => all.map((r) => (r.id === id ? next : r)));
    enqueueRun(next);
  }

  function onRemoveRun(id: string) {
    const r = runs.find((x) => x.id === id);
    if (!r) return;
    if ((r.completed || r.duration_s != null) && !confirm(`Remove ${r.name} and what you logged for it?`)) return;
    setRuns((all) => all.filter((x) => x.id !== id));
    queueRef.current?.enqueue({ table: "session_runs", id, kind: "delete" });
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
        position: nextPosition(),
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
    }
    void loadHistoryFor(ex.id);
  }

  // ---------- swap exercise ----------
  const stripSwap = ({ swap: _s, swapped_to: _t, ...rest }: PrescribedJson): PrescribedJson => rest;

  function emptySets(n: number, sided: boolean): WSet[] {
    return Array.from({ length: n }, (_, i) => ({ ...newSet(uuid(), { kind: "working", sided }), position: i }));
  }

  function attachmentDefaults(ex: ExerciseRow) {
    const ok = ex.default_attachment_id && attachments.some((a) => a.id === ex.default_attachment_id && !a.archived_at);
    return ok
      ? { attachment_state: ex.default_attachment_state, attachment_id: ex.default_attachment_id, attachment_name: attachments.find((a) => a.id === ex.default_attachment_id)?.name ?? null }
      : { attachment_state: ex.default_attachment_state === "none" ? "none" as const : null, attachment_id: null, attachment_name: null };
  }

  /**
   * Swap an exercise. Logged work is never relabelled: with nothing logged the row is replaced in
   * place; otherwise the original keeps its logged sets and the replacement is added right after it
   * for the remaining planned sets. Targets come from the review; no load is ever carried over.
   * "Update program" changes the program's slot for future sessions first, and nothing is swapped if that fails.
   */
  async function onSwap(itemId: string, choice: SwapChoice) {
    const item = itemsRef.current.find((i) => i.id === itemId);
    if (!item) return;
    const { exercise: ex, scope, targets } = choice;
    seenExercises.current.set(ex.id, ex);
    const plan = planSwap(item.sets, (st) => setPerformed(toLoggedSet(st)));
    const at = new Date().toISOString();
    let program: SwapInfo["program"] = null;
    if (scope === "program" && item.template_exercise_id) {
      try {
        const r = await swapTemplateExercise(db, item.template_exercise_id, {
          exercise_id: ex.id, sets: plan.hasLogged ? item.prescribed.sets ?? targets.sets : targets.sets,
          rep_min: targets.rep_min, rep_max: targets.rep_max, rest_s: targets.rest_s,
        }, `Swapped ${item.exercise.name} for ${ex.name}`);
        program = { template_exercise_id: item.template_exercise_id, before: r.before };
      } catch (e) {
        toast.error("The program couldn't be updated, so nothing was swapped.", { description: `${(e as Error).message} You can try again or swap for today only.` });
        return;
      }
    }
    const { target_weight_kg: _load, ...carried } = stripSwap(item.prescribed);
    const prescribed: PrescribedJson = { ...carried, sets: targets.sets, rep_min: targets.rep_min, rep_max: targets.rep_max, rest_s: targets.rest_s };
    const swap: SwapInfo = { from_exercise_id: item.exercise_id, from_name: item.exercise.name, scope: program ? "program" : "today", from_item: null, program, at };
    const curItems = itemsRef.current, curRuns = runsRef.current;
    let replacementId: string;
    if (!plan.hasLogged) {
      // Nothing logged: replace in place, with fresh empty sets in the replacement's mode.
      for (const st of item.sets) queueRef.current?.enqueue({ table: "set_logs", id: st.id, kind: "delete" });
      const next: WExercise = {
        ...item, exercise: ex, exercise_id: ex.id, substituted_for: item.substituted_for ?? item.exercise_id,
        track_sides: ex.track_sides, ...attachmentDefaults(ex),
        prescribed: { ...prescribed, swap: { ...swap, from_prescribed: item.prescribed, from_substituted_for: item.substituted_for, from_mode: { track_sides: item.track_sides, attachment_state: item.attachment_state, attachment_id: item.attachment_id } } },
        sets: emptySets(targets.sets, ex.track_sides),
      };
      replacementId = next.id;
      itemsRef.current = curItems.map((i) => (i.id === item.id ? next : i));
      setItems(itemsRef.current);
      enqueueItem(next);
      next.sets.forEach((st) => enqueueSet(next, st));
    } else {
      // Logged work stays where it is; only the sets not yet done are removed from the original.
      const original: WExercise = {
        ...item, sets: plan.keep.map((st, i) => ({ ...st, position: i })),
        prescribed: { ...item.prescribed, swapped_to: { item: "", exercise_id: ex.id, name: ex.name, sets_moved: plan.movedWorking, at } },
      };
      const repl: WExercise = {
        id: uuid(), exercise: ex, exercise_id: ex.id, template_exercise_id: item.template_exercise_id, substituted_for: item.exercise_id,
        position: item.position + 1, notes: null, track_sides: ex.track_sides, ...attachmentDefaults(ex),
        prescribed: { ...prescribed, swap: { ...swap, from_item: item.id } },
        sets: emptySets(targets.sets, ex.track_sides),
      };
      original.prescribed.swapped_to!.item = repl.id;
      replacementId = repl.id;
      // Make room right after the original: everything later moves down one place.
      const bumpedItems = curItems.filter((i) => i.id !== item.id && i.position > item.position).map((i) => ({ ...i, position: i.position + 1 }));
      const bumpedRuns = curRuns.filter((r) => r.position > item.position).map((r) => ({ ...r, position: r.position + 1 }));
      for (const st of plan.move) queueRef.current?.enqueue({ table: "set_logs", id: st.id, kind: "delete" });
      const nextItems = [...curItems.map((i) => (i.id === item.id ? original : bumpedItems.find((b) => b.id === i.id) ?? i)), repl].sort((a, b) => a.position - b.position);
      const nextRuns = curRuns.map((r) => bumpedRuns.find((b) => b.id === r.id) ?? r);
      itemsRef.current = nextItems; runsRef.current = nextRuns;
      setItems(nextItems); setRuns(nextRuns);
      bumpedItems.forEach(enqueueItem); bumpedRuns.forEach(enqueueRun);
      original.sets.forEach((st) => { if (item.sets.find((o) => o.id === st.id)?.position !== st.position) enqueueSet(original, st); });
      enqueueItem(original);
      enqueueItem(repl);
      repl.sets.forEach((st) => enqueueSet(repl, st));
    }
    if (restRef.current?.itemId === item.id) setRest(null);
    void loadHistoryFor(ex.id);
    toast(`Swapped to ${ex.name}${program ? " · program updated" : " for today"}`, {
      description: plan.hasLogged ? `Your logged sets stay under ${item.exercise.name}.` : undefined,
      duration: 8000,
      action: { label: "Undo", onClick: () => void onUndoSwap(replacementId) },
    });
    setTimeout(() => document.getElementById(`ex-${replacementId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  /** Undo a swap. Refused once the replacement has logged work, so no logged set is ever lost. */
  async function onUndoSwap(replacementId: string) {
    const repl = itemsRef.current.find((i) => i.id === replacementId);
    const swap = repl?.prescribed.swap;
    if (!repl || !swap) { toast("That swap can't be undone any more."); return; }
    if (repl.sets.some((st) => setPerformed(toLoggedSet(st)))) {
      toast(`${repl.exercise.name} already has logged sets, so the swap stays. Remove those sets first if you want to undo it.`);
      return;
    }
    if (swap.program) {
      try {
        const restored = await restoreTemplateExercise(db, swap.program.template_exercise_id, swap.program.before, repl.exercise_id, `Undid swap of ${swap.from_name} for ${repl.exercise.name}`);
        if (!restored) toast("The program slot was changed since, so it was left as it is.");
      } catch (e) {
        toast.error("The program couldn't be restored, so the swap stays.", { description: (e as Error).message });
        return;
      }
    }
    const original = seenExercises.current.get(swap.from_exercise_id) ?? library.find((l) => l.id === swap.from_exercise_id);
    const curItems = itemsRef.current;
    if (!swap.from_item) {
      if (!original) { toast("The original exercise is no longer in your library."); return; }
      const before = swap.from_mode;
      const from = swap.from_prescribed ?? {};
      repl.sets.forEach((st) => queueRef.current?.enqueue({ table: "set_logs", id: st.id, kind: "delete" }));
      const sided = before?.track_sides ?? original.track_sides;
      const next: WExercise = {
        ...repl, exercise: original, exercise_id: original.id, substituted_for: swap.from_substituted_for ?? null, prescribed: from,
        track_sides: sided, attachment_state: before?.attachment_state ?? null, attachment_id: before?.attachment_id ?? null,
        attachment_name: attachments.find((a) => a.id === before?.attachment_id)?.name ?? null,
        sets: emptySets(from.sets ?? original.default_sets, sided),
      };
      itemsRef.current = curItems.map((i) => (i.id === repl.id ? next : i));
      setItems(itemsRef.current);
      enqueueItem(next);
      next.sets.forEach((st) => enqueueSet(next, st));
    } else {
      const orig = curItems.find((i) => i.id === swap.from_item);
      repl.sets.forEach((st) => queueRef.current?.enqueue({ table: "set_logs", id: st.id, kind: "delete" }));
      queueRef.current?.enqueue({ table: "session_exercises", id: repl.id, kind: "delete" });
      let nextItems = curItems.filter((i) => i.id !== repl.id);
      if (orig) {
        // The planned sets that moved come back as new, empty sets; the logged ones were never touched.
        const moved = orig.prescribed.swapped_to?.sets_moved ?? 0;
        const { swapped_to: _gone, ...keep } = orig.prescribed;
        const restored: WExercise = {
          ...orig, prescribed: keep,
          sets: [...orig.sets, ...emptySets(moved, orig.track_sides)].map((st, i) => ({ ...st, position: i })),
        };
        nextItems = nextItems.map((i) => (i.id === orig.id ? restored : i));
        enqueueItem(restored);
        restored.sets.forEach((st) => { if (orig.sets.find((o) => o.id === st.id)?.position !== st.position) enqueueSet(restored, st); });
      }
      itemsRef.current = nextItems;
      setItems(nextItems);
    }
    toast(`Swap undone${swap.program ? " · program restored" : ""}`);
  }

  function onSessionNotes(v: string) {
    setNotes(v);
    queueRef.current?.enqueue({ table: "workout_sessions", id: sessionId, kind: "upsert", row: { notes: v || null } });
  }

  function onEnergy(v: number | null) {
    setEnergy(v);
    setEditingEnergy(false);
    queueRef.current?.enqueue({ table: "workout_sessions", id: sessionId, kind: "upsert", row: { energy_rating: v } });
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
      const p = plannedForProgress(i.prescribed, i.sets);
      planned += p;
      plannedDone += Math.min(p, doneWorkingSets(logged));
    }
    return { done, open, partial, planned, plannedDone };
  }, [items]);
  const runsDone = runs.filter((r) => r.completed).length;
  const shortOfPlan = useMemo(
    () => items.some((i) => isShortOfPlan(i.prescribed, doneWorkingSets(i.sets.map(toLoggedSet)))),
    [items],
  );
  /** The set to do next: the first one not done, in workout order. */
  const activeSetId = useMemo(() => {
    for (const i of items) for (const s of i.sets) if (!setDone(toLoggedSet(s))) return s.id;
    return null;
  }, [items]);

  /** What comes next, shown by the rest timer. Only a description: nothing is completed or skipped. */
  const nextUp = useMemo((): NextUp | null => {
    for (const i of items) {
      let w = 0;
      const drops = new Map<string, number>();
      for (const s of i.sets) {
        if (s.kind === "working") w++;
        if (s.kind === "drop") drops.set(s.drop_parent_id ?? "", (drops.get(s.drop_parent_id ?? "") ?? 0) + 1);
        if (s.id !== activeSetId) continue;
        const planned = plannedSets(i.prescribed, i.sets);
        const reps = i.prescribed.rep_min != null && i.prescribed.rep_max != null
          ? (i.prescribed.rep_min === i.prescribed.rep_max ? `${i.prescribed.rep_max} reps` : `${i.prescribed.rep_min}–${i.prescribed.rep_max} reps`) : null;
        const which = s.kind === "warmup" ? "Warm-up" : s.kind === "drop" ? `Drop ${drops.get(s.drop_parent_id ?? "")}` : `Set ${w}${w <= planned ? ` of ${planned}` : " (extra)"}`;
        const sideToGo = s.sided && (s.left_completed || s.right_completed) ? (s.left_completed ? "right side" : "left side") : null;
        return { title: i.exercise.name, detail: [which, sideToGo, s.kind === "working" ? reps : null].filter(Boolean).join(" · ") };
      }
    }
    const run = runs.find((r) => !r.completed);
    return run ? { title: run.name, detail: "Run" } : null;
  }, [items, runs, activeSetId]);

  // Exercise order in the earlier sessions used for comparison (context for the "Previously exercise N" note).
  const historySessions = useMemo(() => [...new Set(Object.values(history).flat().map((h) => h.sessionId))].sort().join(","), [history]);
  useEffect(() => {
    const missing = historySessions.split(",").filter((id) => id && !(id in prevOrder));
    if (missing.length === 0) return;
    let live = true;
    sessionExerciseOrder(db, missing)
      .then((m) => { if (live) setPrevOrder((cur) => ({ ...cur, ...Object.fromEntries(missing.map((id) => [id, m[id] ?? []])) })); })
      .catch(() => { /* the note is optional context */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, historySessions]);

  /** "Previously exercise 2; today exercise 5." when the compared session had this exercise elsewhere. */
  function orderNote(item: WExercise): string | null {
    const cfg = toExerciseConfig(item.exercise);
    const prev = previousFor(compatibleHistory(history[item.exercise_id] ?? [], toAttachmentRef(item)), item.track_sides ? "left" : "together", cfg)
      ?? previousFor(compatibleHistory(history[item.exercise_id] ?? [], toAttachmentRef(item)), item.track_sides ? "right" : "together", cfg);
    const order = prev ? prevOrder[prev.sessionId] : null;
    if (!order) return null;
    const before = order.indexOf(item.exercise_id) + 1;
    const today = items.findIndex((i) => i.id === item.id) + 1;
    if (before <= 0 || today <= 0 || before === today) return null;
    return `Previously exercise ${before}; today exercise ${today}.`;
  }

  async function finish() {
    for (const item of items) for (const set of item.sets) {
      if (!set.completed) continue;
      if (set.kind === "drop" && !item.sets.find((x) => x.id === set.drop_parent_id)?.completed) {
        toast.error(`${item.exercise.name}: a drop is logged under a set that isn't completed. Complete the set or remove the drop.`);
        return;
      }
      const problems = set.sided
        ? (["left", "right"] as Side[]).filter((sd) => set[`${sd}_completed`]).map((sd) => setProblem(sideValues(set, sd), item.exercise.load_type))
        : [setProblem(set, item.exercise.load_type)];
      const problem = problems.find(Boolean);
      if (problem) { toast.error(`${item.exercise.name}: ${problem}`); return; }
    }
    for (const r of runs) {
      const problem = r.completed ? runProblem(r) : null;
      if (problem) { toast.error(`${r.name}: ${problem}`); return; }
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
      // A run logged right after running would otherwise read as a 0-minute workout: a workout with
      // only runs lasts at least as long as the times recorded for them.
      const runOnlyEnd = counts.done === 0 ? startedAt.getTime() + runs.reduce((a, r) => a + (r.completed ? r.duration_s ?? 0 : 0), 0) * 1000 : 0;
      const ended = backdated ? new Date(startedAt.getTime() + (mins > 0 ? mins : estMinutes) * 60000) : new Date(Math.max(Date.now(), runOnlyEnd));
      await finishWorkout(db, sessionId, notes || null, ended, shortOfPlan ? shortfallReason : null);
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
  // plus the time of each completed run
  const estMinutes = Math.max(10, Math.round((items.reduce((a, i) => a + i.sets.filter((x) => x.completed).length * (40 + (i.prescribed.rest_s ?? profile.default_rest_s)), 0)
    + runs.reduce((a, r) => a + (r.completed ? r.duration_s ?? 0 : 0), 0)) / 60));
  const pickerItem = items.find((i) => i.id === attachmentFor) ?? null;
  const swapItem = items.find((i) => i.id === swapFor) ?? null;
  const restItem = rest?.itemId ? items.find((i) => i.id === rest.itemId) ?? null : null;
  const restLength: RestLengthInfo | null = restItem ? (() => {
    const planned = restFor({ prescribedS: restItem.prescribed.rest_s, exerciseS: restItem.exercise.default_rest_s, profileS: profile.default_rest_s });
    return { itemId: restItem.id, name: restItem.exercise.name, plannedS: planned.seconds, plannedSource: planned.source, overrideS: restOverrides[restItem.id] ?? null };
  })() : null;

  return (
    <div className="min-h-dvh pb-40" onPointerDownCapture={alerts.sound ? unlockRestSound : undefined}>
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
          {!backdated && rest && keyboardOpen ? (
            <RestChip rest={rest} onSkip={clearRest} />
          ) : !backdated && (
            <button
              aria-label={rest ? "Restart rest timer" : "Start rest timer"}
              onClick={() => {
                unlockRestSound();
                // A manual rest uses the rest of the exercise you're on (or your default between exercises).
                const item = items.find((i) => i.sets.some((x) => x.id === activeSetId));
                const r = item ? restOf(item) : { seconds: profile.default_rest_s, source: "default" as const };
                setRest(startRest(r.seconds, Date.now(), { label: item?.exercise.name ?? "Manual", itemId: item?.id ?? null, source: item ? r.source : "manual" }));
              }}
              className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <Timer className="size-[18px]" />
            </button>
          )}
          <Menu>
            <MenuTrigger aria-label="Workout options" className="grid size-10 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted">
              <MoreHorizontal className="size-5" />
            </MenuTrigger>
            {/* Opening reorder mode moves focus into it; don't let the menu pull focus back to its trigger. */}
            <MenuContent onCloseAutoFocus={(e) => { if (openingReorderRef.current) { openingReorderRef.current = false; e.preventDefault(); } }}>
              <MenuItem onSelect={() => setPicker({ mode: "add" })}><Plus /> Add exercise</MenuItem>
              <MenuItem onSelect={onAddRun}><Footprints /> Add run</MenuItem>
              <MenuItem disabled={items.length + runs.length < 2} onSelect={() => { openingReorderRef.current = true; setReorder({ focusId: null }); }}><ArrowUpDown /> Reorder exercises</MenuItem>
              <MenuItem onSelect={() => setEditingEnergy(true)}>
                <Gauge /> {energy == null ? "Add starting energy" : <>Starting energy <span className="ml-auto pl-3 text-muted-foreground tabular">{energy}/10</span></>}
              </MenuItem>
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
        {reorder ? (
          <ReorderList entries={reorderEntries()} focusId={reorder.focusId} onMove={onMove} onDone={closeReorder} />
        ) : (<>
        {workoutOrder(items, runs).map((entry, idx, order) => {
          if (entry.kind === "run") {
            const run = runs.find((r) => r.id === entry.id)!;
            return (
              <div id={`run-${run.id}`} key={run.id} className="scroll-mt-20">
                <RunCard run={run} unit={distUnit} live isFirst={idx === 0} isLast={idx === order.length - 1}
                  active={!activeSetId && runs.find((r) => !r.completed)?.id === run.id}
                  onChange={(patch) => onRunChange(run.id, patch)} onComplete={() => onCompleteRun(run.id)}
                  onReorder={() => setReorder({ focusId: run.id })} onRemove={() => onRemoveRun(run.id)} />
              </div>
            );
          }
          const item = items.find((i) => i.id === entry.id)!;
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
                isLast={idx === order.length - 1}
                activeSetId={activeSetId}
                orderNote={orderNote(item)}
                onCopyPrevious={(id, side, values) => onCopyPrevious(item.id, id, side, values)}
                onSwap={() => setSwapFor(item.id)}
                onUndoSwap={() => void onUndoSwap(item.id)}
                onSetChange={(id, patch) => onSetChange(item, id, patch)}
                onSideChange={(id, side, patch) => onSideChange(item, id, side, patch)}
                onCompleteSide={(id, side) => onCompleteSide(item, id, side)}
                onCopyLeftToRight={(id) => onCopyLeftToRight(item, id)}
                onToggleSides={() => onToggleSides(item)}
                onPickAttachment={() => setAttachmentFor(item.id)}
                onCompleteSet={(id) => onCompleteSet(item, id)}
                onAddSet={(k) => onAddSet(item, k)}
                onAddDrop={(id) => onAddDrop(item, id)}
                onRemoveSet={(id) => onRemoveSet(item, id)}
                onToggleKind={(id) => onToggleKind(item, id)}
                onNotes={(v) => onNotes(item, v)}
                onReorder={() => setReorder({ focusId: item.id })}
                onRemove={() => onRemove(item)}
                onDismissRecommendation={() => onDismiss(item)}
              />
            </div>
          );
        })}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" className="w-full" onClick={() => setPicker({ mode: "add" })}>
            <Plus /> Add exercise
          </Button>
          <Button variant="outline" size="lg" className="w-full" onClick={onAddRun}>
            <Footprints /> Add run
          </Button>
        </div>
        </>)}

        <div className="pt-4">
          <label className="mb-1.5 block px-1 text-[15px] font-semibold tracking-tight" htmlFor="session-notes">Workout notes</label>
          <Textarea id="session-notes" value={notes} onChange={(e) => onSessionNotes(e.target.value)} placeholder="Sleep, energy, anything worth remembering…" />
        </div>
      </div>

      <EnergySheet open={editingEnergy} onOpenChange={setEditingEnergy} mode="edit" initial={energy} onSubmit={onEnergy} />

      <RestTimer
        rest={rest}
        hidden={keyboardOpen}
        onAdjust={onAdjustRest}
        onSkip={clearRest}
        onExpire={clearRest}
        next={nextUp}
        length={restLength}
        onLength={(sec) => restLength && onRestLength(restLength.itemId, sec)}
        alerts={alerts}
        onAlerts={setAlerts}
        betweenSides={{ available: items.some((i) => i.track_sides || i.sets.some((x) => x.sided)), on: betweenSides, onChange: setBetweenSides }}
      />

      <SwapSheet
        open={swapItem != null}
        onOpenChange={(o) => !o && setSwapFor(null)}
        item={swapItem}
        library={library}
        history={history}
        loadHistory={loadHistoryFor}
        unit={unit}
        program={swapItem?.template_exercise_id && initialSession.program_id
          ? { available: true }
          : { available: false, reason: "Only exercises that came from a program workout can update the program." }}
        onConfirm={(c) => swapItem && void onSwap(swapItem.id, c)}
      />

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
        title="Add exercise"
        onPick={onPick}
      />

      <Sheet open={finishing} onOpenChange={setFinishing}>
        <SheetContent
          title={backdated ? "Save workout?" : "Finish workout?"}
          description={`${backdated ? format(startedAt, "EEEE d MMMM") : formatDuration(elapsed)} · ${counts.done} set${counts.done === 1 ? "" : "s"} completed${runsDone ? ` · ${runsDone} run${runsDone === 1 ? "" : "s"} done` : ""}`}
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
          {runs.length > runsDone && (
            <p className="mb-4 rounded-md bg-muted px-3 py-2.5 text-[13.5px] text-muted-foreground">
              {runs.length - runsDone} run{runs.length - runsDone === 1 ? "" : "s"} not marked done will be left out of the record.
            </p>
          )}
          {counts.done === 0 && runsDone === 0 && <p className="mb-4 text-[13.5px] text-muted-foreground">Nothing completed yet. You can discard the workout instead.</p>}
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="lg" onClick={finish} disabled={busy || (counts.done === 0 && runsDone === 0)}>
              {busy && <Loader2 className="animate-spin" />} {backdated ? "Save workout" : "Finish & save"}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setFinishing(false)}>{backdated ? "Keep editing" : "Keep training"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

