"use client";
// Reliable autosave for the active workout.
//
// - Every change becomes an op keyed by row id; later ops for the same row are merged,
//   so rapid edits produce one write.
// - Ops are idempotent upserts/deletes on client-generated UUIDs: a retry or a double tap
//   can never create a duplicate set.
// - The pending queue is persisted to localStorage, so closing the tab before a write lands
//   loses nothing: the queue is replayed on next load.
// - Failed writes retry with exponential backoff.
import type { SupabaseClient } from "@supabase/supabase-js";

export type SyncTable = "set_logs" | "session_exercises" | "workout_sessions";
export interface SyncOp {
  table: SyncTable;
  id: string;
  kind: "upsert" | "delete";
  row?: Record<string, unknown>;
}
export type SyncStatus = "idle" | "saving" | "error" | "offline";

const TABLE_ORDER: Record<SyncTable, number> = { workout_sessions: 0, session_exercises: 1, set_logs: 2 };

export class SyncQueue {
  private ops = new Map<string, SyncOp>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private attempt = 0;
  private listeners = new Set<(s: SyncStatus, pending: number) => void>();
  status: SyncStatus = "idle";

  constructor(private db: SupabaseClient, private storageKey: string) {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) for (const op of JSON.parse(saved) as SyncOp[]) this.ops.set(`${op.table}:${op.id}`, op);
    } catch {
      /* ignore corrupt buffer */
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.schedule(0));
    }
  }

  get pending() {
    return this.ops.size;
  }

  subscribe(fn: (s: SyncStatus, pending: number) => void) {
    this.listeners.add(fn);
    fn(this.status, this.ops.size);
    return () => this.listeners.delete(fn);
  }

  private emit(s: SyncStatus) {
    this.status = s;
    this.listeners.forEach((l) => l(s, this.ops.size));
  }

  private persist() {
    try {
      if (this.ops.size) localStorage.setItem(this.storageKey, JSON.stringify([...this.ops.values()]));
      else localStorage.removeItem(this.storageKey);
    } catch {
      /* storage full or unavailable — DB remains source of truth */
    }
  }

  enqueue(op: SyncOp) {
    const key = `${op.table}:${op.id}`;
    const prev = this.ops.get(key);
    if (op.kind === "upsert" && prev?.kind === "upsert") {
      this.ops.set(key, { ...op, row: { ...prev.row, ...op.row } });
    } else {
      this.ops.delete(key); // re-insert to keep ordering of latest intent
      this.ops.set(key, op);
    }
    this.persist();
    this.emit(this.status === "error" || this.status === "offline" ? this.status : "saving");
    this.schedule(400);
  }

  schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Write everything pending. Resolves true when the queue is empty. */
  async flush(): Promise<boolean> {
    if (this.flushing) return false;
    if (this.ops.size === 0) {
      this.emit("idle");
      return true;
    }
    this.flushing = true;
    this.emit("saving");
    try {
      const batch = [...this.ops.values()];
      const upserts = batch.filter((o) => o.kind === "upsert").sort((a, b) => TABLE_ORDER[a.table] - TABLE_ORDER[b.table]);
      const deletes = batch.filter((o) => o.kind === "delete").sort((a, b) => TABLE_ORDER[b.table] - TABLE_ORDER[a.table]);

      for (const table of ["workout_sessions", "session_exercises", "set_logs"] as SyncTable[]) {
        const rows = upserts.filter((o) => o.table === table);
        if (!rows.length) continue;
        if (table === "workout_sessions") {
          for (const o of rows) {
            const { error } = await this.db.from(table).update(o.row!).eq("id", o.id);
            if (error) throw error;
          }
        } else {
          // Group rows with identical column sets so PostgREST upserts them in one request.
          const groups = new Map<string, Record<string, unknown>[]>();
          for (const o of rows) {
            const row = { id: o.id, ...o.row };
            const sig = Object.keys(row).sort().join(",");
            groups.set(sig, [...(groups.get(sig) ?? []), row]);
          }
          for (const g of groups.values()) {
            const { error } = await this.db.from(table).upsert(g, { onConflict: "id" });
            if (error) throw error;
          }
        }
      }
      for (const table of ["set_logs", "session_exercises"] as SyncTable[]) {
        const ids = deletes.filter((o) => o.table === table).map((o) => o.id);
        if (!ids.length) continue;
        const { error } = await this.db.from(table).delete().in("id", ids);
        if (error) throw error;
      }

      // Remove only ops that weren't superseded while we were writing.
      for (const o of batch) {
        const key = `${o.table}:${o.id}`;
        if (this.ops.get(key) === o) this.ops.delete(key);
      }
      this.attempt = 0;
      this.persist();
      this.flushing = false;
      if (this.ops.size) this.schedule(50);
      else this.emit("idle");
      return this.ops.size === 0;
    } catch (e) {
      this.flushing = false;
      this.attempt++;
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      this.emit(offline ? "offline" : "error");
      console.error("autosave failed", e);
      this.schedule(Math.min(30000, 1000 * 2 ** Math.min(this.attempt, 5)));
      return false;
    }
  }
}
