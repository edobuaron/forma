import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SyncQueue, type LocalCopy, type SyncStatus } from "../sync-queue";

// A fake Supabase client whose writes fail until `failures` runs out.
function fakeDb(failures = 0) {
  const calls = { writes: 0 };
  const result = () => {
    calls.writes++;
    return Promise.resolve({ error: failures-- > 0 ? { message: "network down" } : null });
  };
  const db = {
    from: () => ({
      upsert: result,
      update: () => ({ eq: result }),
      delete: () => ({ in: result }),
    }),
  } as unknown as SupabaseClient;
  return { db, calls };
}

function fakeStorage({ broken = false } = {}) {
  const data = new Map<string, string>();
  return {
    data,
    broken,
    getItem: (k: string) => data.get(k) ?? null,
    setItem(k: string, v: string) {
      if (this.broken) throw new DOMException("quota exceeded", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem(k: string) {
      if (this.broken) throw new DOMException("denied", "SecurityError");
      data.delete(k);
    },
  };
}

const op = (id: string, reps: number) => ({ table: "set_logs" as const, id, kind: "upsert" as const, row: { reps } });

function track(q: SyncQueue) {
  const states: { status: SyncStatus; pending: number; local: LocalCopy }[] = [];
  q.subscribe((status, pending, local) => states.push({ status, pending, local }));
  return { last: () => states[states.length - 1] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SyncQueue local persistence", () => {
  it("reports changes as buffered on the device when storage works", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const { db } = fakeDb(1);
    const q = new SyncQueue(db, "k");
    const t = track(q);
    q.enqueue(op("a", 5));
    expect(t.last()).toMatchObject({ pending: 1, local: "device" });
    expect(JSON.parse(storage.data.get("k")!)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(400); // write fails
    expect(t.last()).toMatchObject({ pending: 1, local: "device" });
    expect(t.last().status).not.toBe("idle");
  });

  it("reports memory-only changes when storage fails, instead of claiming they're on the device", async () => {
    vi.stubGlobal("localStorage", fakeStorage({ broken: true }));
    const { db } = fakeDb(1);
    const q = new SyncQueue(db, "k");
    const t = track(q);
    q.enqueue(op("a", 5));
    expect(t.last()).toMatchObject({ pending: 1, local: "memory" });
    await vi.advanceTimersByTimeAsync(400);
    expect(t.last()).toMatchObject({ pending: 1, local: "memory" });
    expect(q.local).toBe("memory");
  });

  it("goes back to device-buffered once storage works again", () => {
    const storage = fakeStorage({ broken: true });
    vi.stubGlobal("localStorage", storage);
    const q = new SyncQueue(fakeDb().db, "k");
    const t = track(q);
    q.enqueue(op("a", 5));
    expect(t.last().local).toBe("memory");
    storage.broken = false;
    q.enqueue(op("b", 6));
    expect(t.last()).toMatchObject({ pending: 2, local: "device" });
    expect(JSON.parse(storage.data.get("k")!)).toHaveLength(2);
  });

  it("keeps retrying with backoff until the server has everything", async () => {
    const storage = fakeStorage({ broken: true });
    vi.stubGlobal("localStorage", storage);
    const { db, calls } = fakeDb(2);
    const q = new SyncQueue(db, "k");
    const t = track(q);
    q.enqueue(op("a", 5));
    await vi.advanceTimersByTimeAsync(400); // attempt 1 fails, retry in 2 s
    expect(calls.writes).toBe(1);
    await vi.advanceTimersByTimeAsync(2000); // attempt 2 fails, retry in 4 s
    expect(calls.writes).toBe(2);
    expect(t.last().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(4000); // attempt 3 succeeds
    expect(calls.writes).toBe(3);
    expect(t.last()).toMatchObject({ status: "idle", pending: 0 });
  });

  it("replays a buffered queue from a previous page load", async () => {
    const storage = fakeStorage();
    storage.data.set("k", JSON.stringify([op("a", 5)]));
    vi.stubGlobal("localStorage", storage);
    const { db, calls } = fakeDb();
    const q = new SyncQueue(db, "k");
    const t = track(q);
    expect(t.last()).toMatchObject({ pending: 1, local: "device" });
    expect(await q.flush()).toBe(true);
    expect(calls.writes).toBe(1);
    expect(storage.data.has("k")).toBe(false);
  });
});

describe("SyncQueue under rapid reordering", () => {
  // A client whose first write hangs until released, recording every row it is sent.
  function slowDb() {
    const sent: Record<string, unknown>[][] = [];
    let release: () => void = () => {};
    let first = true;
    const db = {
      from: () => ({
        upsert: (rows: Record<string, unknown>[]) => {
          sent.push(rows);
          if (!first) return Promise.resolve({ error: null });
          first = false;
          return new Promise((res) => { release = () => res({ error: null }); });
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        delete: () => ({ in: () => Promise.resolve({ error: null }) }),
      }),
    } as unknown as SupabaseClient;
    return { db, sent, release: () => release() };
  }
  const move = (id: string, position: number) => ({ table: "session_exercises" as const, id, kind: "upsert" as const, row: { position } });

  it("merges taps made before a write into one write of the latest position", async () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const { db, sent, release } = slowDb();
    const q = new SyncQueue(db, "k");
    q.enqueue(move("a", 2));
    q.enqueue(move("a", 1));
    q.enqueue(move("a", 0));
    await vi.advanceTimersByTimeAsync(400);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual([[{ id: "a", position: 0 }]]);
  });

  it("a move made while an older write is in flight is written after it, so the newest order wins", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const { db, sent, release } = slowDb();
    const q = new SyncQueue(db, "k");
    q.enqueue(move("a", 1));
    await vi.advanceTimersByTimeAsync(400); // write of position 1 starts and hangs
    q.enqueue(move("a", 0)); // newer tap during the write
    await vi.advanceTimersByTimeAsync(400); // a second flush must not start while one is running
    expect(sent).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.map((rows) => rows[0].position)).toEqual([1, 0]);
    expect(q.pending).toBe(0);
    expect(storage.data.has("k")).toBe(false);
  });
});
