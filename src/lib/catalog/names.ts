// Exercise-name keys for duplicate detection. Mirrors public.exercise_name_key() in migration 009:
// lowercase, split on anything that isn't a letter or digit, drop a plural "s" from words longer
// than two letters (but not "ss"), and join. "Pull-Ups", "pull up" and "Pullup" share one key.
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (w.length >= 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join("");
}

/** Strip control characters (keeping newlines when allowed), collapse runs of spaces, trim. */
export function cleanText(s: string, opts: { multiline?: boolean } = {}): string {
  const noCtl = opts.multiline ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "") : s.replace(/[\u0000-\u001F\u007F]/g, " ");
  return (opts.multiline ? noCtl.replace(/[ \t]+/g, " ") : noCtl.replace(/\s+/g, " ")).trim();
}
