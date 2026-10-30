// Which workout the dashboard puts first. Presentation only: every workout stays one tap away.

export interface NextChoice<T> {
  template: T;
  /** "rotation": the recent sessions follow program order, so this is the next one in that order.
   *  "suggested": no established rotation; this is the least recently completed workout. */
  basis: "rotation" | "suggested";
}

/**
 * `templates` are in program order; `recentTemplateIds` are completed sessions, newest first
 * (null for sessions not started from a template).
 *
 * A rotation counts as established when the last `templates.length` template sessions (at least 2)
 * each advanced exactly one step in program order, wrapping around. Anything else (skips, repeats,
 * free-form sessions in between, too little history) falls back to the least recently completed workout.
 */
export function chooseNext<T extends { id: string; lastDone: string | null }>(templates: T[], recentTemplateIds: (string | null)[]): NextChoice<T> | null {
  if (!templates.length) return null;
  const k = templates.length;
  const index = new Map(templates.map((t, i) => [t.id, i]));
  if (k >= 2) {
    const recent = recentTemplateIds.slice(0, k);
    if (recent.length === k && recent.every((id) => id != null && index.has(id))) {
      const pos = recent.map((id) => index.get(id!)!);
      const stepsInOrder = pos.every((p, i) => i === 0 || (pos[i] + 1) % k === pos[i - 1]);
      if (stepsInOrder) return { template: templates[(pos[0] + 1) % k], basis: "rotation" };
    }
  }
  // Never-done first, then oldest; ties keep program order (the sort is stable).
  const least = [...templates].sort((a, b) => (a.lastDone ?? "").localeCompare(b.lastDone ?? ""))[0];
  return { template: least, basis: "suggested" };
}
