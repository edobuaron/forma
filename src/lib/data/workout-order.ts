// One order for everything in a workout: exercises and runs share position numbers.

export type OrderEntry = { kind: "exercise" | "run"; id: string; position: number };

/** Exercises and runs in workout order. Ties (legacy rows) put exercises first. */
export function workoutOrder(items: { id: string; position: number }[], runs: { id: string; position: number }[]): OrderEntry[] {
  return [
    ...items.map((i) => ({ kind: "exercise" as const, id: i.id, position: i.position })),
    ...runs.map((r) => ({ kind: "run" as const, id: r.id, position: r.position })),
  ].sort((a, b) => a.position - b.position || (a.kind === b.kind ? 0 : a.kind === "exercise" ? -1 : 1));
}

/**
 * Move one entry a single place up (-1) or down (+1) and renumber the whole order 0..n-1.
 * Returns the new position of every entry, or null when the move isn't possible (already at the
 * top or bottom, or unknown id). Only positions change: callers keep every other field as it was.
 */
export function moveInOrder(order: OrderEntry[], id: string, dir: -1 | 1): Map<string, number> | null {
  const index = order.findIndex((e) => e.id === id);
  const j = index + dir;
  if (index < 0 || j < 0 || j >= order.length) return null;
  const next = [...order];
  [next[index], next[j]] = [next[j], next[index]];
  return new Map(next.map((e, k) => [e.id, k]));
}

/** Rows whose position differs from the new numbering, with the new position applied. */
export function repositioned<T extends { id: string; position: number }>(rows: T[], pos: Map<string, number>): T[] {
  return rows.filter((r) => pos.has(r.id) && pos.get(r.id) !== r.position).map((r) => ({ ...r, position: pos.get(r.id)! }));
}
