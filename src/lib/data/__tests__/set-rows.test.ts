import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  copyLeftToRight, newSet, patchSide, removalKind, removeSet, restoreSet, setSideCompleted, switchMode, type SetRow,
} from "../set-rows";
import { SyncQueue } from "../sync-queue";
import { emptySideColumns, toLoggedSet } from "../types";
import { doneWorkingSets, setDone } from "@/lib/domain/sides";

const row = (id: string, position: number, o: Partial<SetRow> = {}): SetRow => ({
  id, position, kind: "working", weight_kg: null, assistance_kg: null, reps: null, rir: null,
  completed: false, completed_at: null, notes: null, ...emptySideColumns(), ...o,
});
const sided = (id: string, position: number, o: Partial<SetRow> = {}) => row(id, position, { ...emptySideColumns(true), ...o });

describe("left/right rows", () => {
  it("each side keeps its own load, reps, RIR and completion", () => {
    let s = sided("a", 0);
    s = setSideCompleted(s, "left", true, "t1", { weight_kg: 25, reps: 10, rir: 2 });
    expect(s).toMatchObject({ left_weight_kg: 25, left_reps: 10, left_rir: 2, left_completed: true, right_completed: false, completed: true });
    expect(setDone(toLoggedSet(s))).toBe(false);
    s = setSideCompleted(s, "right", true, "t2", { weight_kg: 22.5, reps: 8 });
    expect(setDone(toLoggedSet(s))).toBe(true);
    expect(s.left_weight_kg).toBe(25);
  });

  it("Copy left to right copies values but never completes the right side", () => {
    const s = copyLeftToRight(setSideCompleted(sided("a", 0), "left", true, "t", { weight_kg: 20, reps: 12, rir: 1 }), "external");
    expect(s).toMatchObject({ right_weight_kg: 20, right_reps: 12, right_rir: 1, right_completed: false });
  });

  it("clearing a performed side's reps un-completes that side only", () => {
    let s = setSideCompleted(sided("a", 0), "left", true, "t", { weight_kg: 20, reps: 12 });
    s = setSideCompleted(s, "right", true, "t", { weight_kg: 20, reps: 10 });
    s = patchSide(s, "left", { reps: null }, "external");
    expect(s).toMatchObject({ left_completed: false, right_completed: true, completed: true });
  });

  it("switching mode never discards logged values", () => {
    const sets = [row("a", 0, { weight_kg: 20, reps: 10, completed: true }), row("b", 1, { weight_kg: 20 }), row("c", 2)];
    const r = switchMode(sets, true);
    expect(r.kept).toBe(2);
    expect(r.sets.map((s) => s.sided)).toEqual([false, false, true]);
    expect(r.sets[0]).toEqual(sets[0]);
    const back = switchMode([setSideCompleted(sided("d", 0), "left", true, "t", { weight_kg: 20, reps: 8 }), sided("e", 1)], false);
    expect(back.kept).toBe(1);
    expect(back.sets[0].left_reps).toBe(8);
    expect(back.sets[1].sided).toBe(false);
  });

  it("new sets take the exercise's mode and carry loads, never reps or completion", () => {
    const from = setSideCompleted(sided("a", 0), "left", true, "t", { weight_kg: 25, reps: 10 });
    const s = newSet("b", { kind: "working", sided: true, from: { ...from, right_weight_kg: 22.5 } });
    expect(s).toMatchObject({ sided: true, left_weight_kg: 25, right_weight_kg: 22.5, left_reps: null, left_completed: false, completed: false });
  });
});

describe("removing a set", () => {
  const prescribed = { sets: 3 };
  const sets = [row("a", 0, { weight_kg: 60, reps: 10, completed: true, completed_at: "t" }), sided("b", 1), row("c", 2), row("x", 3)];

  it("tells an extra set from a planned one, and never lowers the plan", () => {
    expect(removalKind(prescribed, sets, "x")).toBe("extra");
    expect(removalKind(prescribed, sets.slice(0, 3), "c")).toBe("planned");
    const { sets: left } = removeSet(sets.slice(0, 3), "c");
    expect(doneWorkingSets(left.map(toLoggedSet))).toBe(1); // still 1 of 3 planned: not a finished exercise
  });

  it("Undo restores values, completion, sides and order, and is idempotent", () => {
    const withSides = sets.map((s) => (s.id === "b" ? setSideCompleted(s, "left", true, "t", { weight_kg: 20, reps: 9 }) : s));
    const { sets: after, removed } = removeSet(withSides, "b");
    const r = restoreSet(after, removed!);
    expect(r.sets.map((s) => s.id)).toEqual(["a", "b", "c", "x"]);
    expect(r.sets[1]).toEqual(withSides[1]);
    expect(restoreSet(r.sets, removed!).sets).toEqual(r.sets);
  });
});

// ---------- deletion + Undo through the autosave queue ----------
function fakeServer() {
  const rows = new Map<string, Record<string, unknown>>();
  let gate: Promise<void> | null = null;
  let fail = 0;
  const wait = async () => { if (gate) await gate; };
  const result = (fn: () => void) => async () => {
    await wait();
    if (fail > 0) { fail--; return { error: { message: "network down" } }; }
    fn();
    return { error: null };
  };
  const db = {
    from: () => ({
      upsert: (g: Record<string, unknown>[]) => result(() => g.forEach((r) => rows.set(r.id as string, { ...rows.get(r.id as string), ...r })))(),
      update: () => ({ eq: result(() => {}) }),
      delete: () => ({ in: (_c: string, ids: string[]) => result(() => ids.forEach((id) => rows.delete(id)))() }),
    }),
  } as unknown as SupabaseClient;
  return {
    db, rows,
    hold() { let release!: () => void; gate = new Promise((r) => { release = r; }); return () => { gate = null; release(); }; },
    failNext(n: number) { fail = n; },
  };
}

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("deletion and Undo during autosave", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("localStorage", storage()); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const done = sided("s1", 0, {
    left_weight_kg: 25, left_reps: 10, left_completed: true, left_completed_at: "t", right_weight_kg: 22.5, right_reps: 8,
    right_completed: true, right_completed_at: "t", completed: true, completed_at: "t",
  });
  const up = (s: SetRow) => ({ table: "set_logs" as const, id: s.id, kind: "upsert" as const, row: { ...s } });
  const del = (id: string) => ({ table: "set_logs" as const, id, kind: "delete" as const });

  it("Undo before the delete was sent: the row is never deleted", async () => {
    const srv = fakeServer();
    srv.rows.set("s1", { ...done });
    const q = new SyncQueue(srv.db, "k");
    q.enqueue(del("s1"));
    q.enqueue(up(done));
    await vi.advanceTimersByTimeAsync(500);
    expect(srv.rows.get("s1")).toMatchObject({ left_weight_kg: 25, right_reps: 8, right_completed: true });
    expect(q.pending).toBe(0);
  });

  it("Undo while the delete is in flight: the restore is written after it", async () => {
    const srv = fakeServer();
    srv.rows.set("s1", { ...done });
    const q = new SyncQueue(srv.db, "k");
    q.enqueue(del("s1"));
    const release = srv.hold();
    await vi.advanceTimersByTimeAsync(400); // delete sent, waiting on the network
    q.enqueue(up(done));
    release();
    await vi.advanceTimersByTimeAsync(500);
    expect(srv.rows.get("s1")).toMatchObject({ left_completed: true, right_completed: true, position: 0 });
    expect(q.pending).toBe(0);
  });

  it("Undo during retries, then a reload: the restored row survives", async () => {
    const srv = fakeServer();
    srv.rows.set("s1", { ...done });
    srv.failNext(10);
    const q = new SyncQueue(srv.db, "k");
    q.enqueue(del("s1"));
    await vi.advanceTimersByTimeAsync(400); // fails, will retry
    q.enqueue(up(done));
    // Page reloads before anything reaches the server: the buffered queue holds only the latest intent.
    const buffered = JSON.parse(localStorage.getItem("k")!) as { kind: string }[];
    expect(buffered.map((o) => o.kind)).toEqual(["upsert"]);
    srv.failNext(0);
    const q2 = new SyncQueue(srv.db, "k");
    expect(await q2.flush()).toBe(true);
    expect(srv.rows.get("s1")).toMatchObject({ left_weight_kg: 25, right_weight_kg: 22.5 });
  });

  it("a delete that reached the server is undone by re-creating the same row id", async () => {
    const srv = fakeServer();
    srv.rows.set("s1", { ...done });
    const q = new SyncQueue(srv.db, "k");
    q.enqueue(del("s1"));
    await vi.advanceTimersByTimeAsync(500);
    expect(srv.rows.has("s1")).toBe(false);
    q.enqueue(up(done));
    await vi.advanceTimersByTimeAsync(500);
    expect(srv.rows.get("s1")).toMatchObject({ id: "s1", left_reps: 10, right_reps: 8 });
  });
});
