// Copying the matched previous set into today's set. Pure, no I/O.
// Copy fills values only: it never completes a set and never replaces a value already entered
// without an explicit second step.

export interface SetValues {
  /** Weight, added weight or assistance, depending on the exercise's load type (kg). */
  load: number | null;
  reps: number | null;
  rir: number | null;
}

export type CopyField = keyof SetValues;

export interface CopyPlan {
  /** Empty fields that take the previous value. */
  fill: Partial<SetValues>;
  /** Fields already entered with a different value: replaced only if the user confirms. */
  conflicts: Partial<SetValues>;
  /** Nothing to do: every copied field already holds the previous value. */
  same: boolean;
}

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * What copying `previous` into `current` would change. Fields the previous set didn't record (such as
 * RIR) are left alone; `includeRir: false` leaves RIR out entirely, for when RIR inputs are hidden.
 */
export function planCopy(current: SetValues, previous: SetValues, opts: { includeRir: boolean }): CopyPlan {
  const fields: CopyField[] = opts.includeRir ? ["load", "reps", "rir"] : ["load", "reps"];
  const fill: Partial<SetValues> = {};
  const conflicts: Partial<SetValues> = {};
  for (const f of fields) {
    const p = previous[f];
    if (p == null) continue;
    const c = current[f];
    if (c == null) fill[f] = p;
    else if (!eq(c, p)) conflicts[f] = p;
  }
  return { fill, conflicts, same: Object.keys(fill).length === 0 && Object.keys(conflicts).length === 0 };
}
