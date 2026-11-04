"use client";
import { ArrowDown, ArrowUp, Check, Footprints } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReorderEntry {
  id: string;
  kind: "exercise" | "run";
  name: string;
  detail: string;
}

/**
 * Reorder mode: every exercise and run with its own Up and Down buttons, visible until Done.
 * After a move, focus stays on the same button of the moved entry (or its other button once it
 * reaches the top or bottom), and the entry is scrolled into view, so repeated taps or key
 * presses keep moving the same thing.
 */
export function ReorderList({ entries, focusId, onMove, onDone }: {
  entries: ReorderEntry[];
  /** Entry to focus when the mode opens (the card it was opened from). */
  focusId: string | null;
  onMove: (id: string, dir: -1 | 1) => void;
  onDone: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [last, setLast] = useState<{ id: string; dir: -1 | 1; n: number } | null>(null);
  const [announce, setAnnounce] = useState("");

  const button = (id: string, dir: -1 | 1) =>
    listRef.current?.querySelector<HTMLButtonElement>(`[data-reorder="${CSS.escape(id)}:${dir}"]`) ?? null;

  // Opening: focus the entry it was opened from, else Done. Waits a tick so the menu that opened
  // the mode has closed and released its focus trap.
  useEffect(() => {
    const t = setTimeout(focusOnOpen, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusOnOpen() {
    const row = focusId ? listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(focusId)}"]`) : null;
    if (row) {
      row.scrollIntoView({ block: "center" });
      const up = button(focusId!, -1);
      (up && !up.disabled ? up : button(focusId!, 1))?.focus({ preventScroll: true });
    } else {
      doneRef.current?.focus();
    }
  }

  // After each move: the moved row's DOM node changed place, which drops focus. Put it back.
  useLayoutEffect(() => {
    if (!last) return;
    const same = button(last.id, last.dir);
    const target = same && !same.disabled ? same : button(last.id, last.dir === -1 ? 1 : -1);
    target?.focus({ preventScroll: true });
    listRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(last.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [last]);

  function move(id: string, dir: -1 | 1) {
    const i = entries.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= entries.length) return;
    onMove(id, dir);
    setLast((p) => ({ id, dir, n: (p?.n ?? 0) + 1 }));
    setAnnounce(`${entries[i].name} moved to position ${j + 1} of ${entries.length}.`);
  }

  return (
    <section aria-labelledby="reorder-title" className="rounded-xl border bg-card shadow-card">
      {/* Title and Done stay pinned under the workout header while the list scrolls. */}
      <div className="sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-20 flex items-center gap-3 rounded-t-xl border-b bg-card px-4 py-2.5 md:px-5">
        <h2 id="reorder-title" className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-[-0.02em]">Reorder exercises</h2>
        <Button ref={doneRef} variant="primary" size="md" onClick={onDone}><Check /> Done</Button>
      </div>
      <p className="border-b px-4 py-2.5 text-[12.5px] text-muted-foreground md:px-5">
        Changes the order of this workout only. Your program keeps its order, and logged sets stay as they are.
      </p>
      <ol ref={listRef} className="divide-y">
        {entries.map((e, i) => (
          <li key={e.id} data-row={e.id} className="flex scroll-mt-36 scroll-mb-4 items-center gap-3 px-4 py-2.5 md:px-5">
            <span aria-hidden className="w-5 shrink-0 text-right text-[13px] font-semibold text-muted-foreground tabular">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-[15px] font-semibold tracking-[-0.01em]">
                {e.kind === "run" && <Footprints aria-hidden className="size-4 shrink-0 text-accent" />}
                <span className="truncate">{e.name}</span>
              </p>
              <p className="truncate text-[12.5px] text-muted-foreground tabular">{e.detail}</p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {([-1, 1] as const).map((dir) => {
                const disabled = dir === -1 ? i === 0 : i === entries.length - 1;
                const Icon = dir === -1 ? ArrowUp : ArrowDown;
                return (
                  <button
                    key={dir}
                    type="button"
                    data-reorder={`${e.id}:${dir}`}
                    disabled={disabled}
                    aria-label={`Move ${e.name} ${dir === -1 ? "up" : "down"}`}
                    onClick={() => move(e.id, dir)}
                    className={cn(
                      "grid size-11 place-items-center rounded-lg border border-input bg-card text-foreground transition-colors",
                      "hover:border-accent/50 hover:bg-muted active:scale-[0.96] disabled:pointer-events-none disabled:opacity-30",
                      "outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                    )}
                  >
                    <Icon className="size-5" />
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">{announce}</p>
    </section>
  );
}
