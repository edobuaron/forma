"use client";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, History, Info, MoreHorizontal, NotebookPen, Plus, Repeat, Trash2, X,
} from "lucide-react";
import { useId, useState } from "react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Textarea } from "@/components/ui/input";
import { compareSet, previousCounterpart, summarisePrevious } from "@/lib/domain/comparison";
import { headline, type Recommendation } from "@/lib/domain/progression";
import { workingSets } from "@/lib/domain/sets";
import type { ExerciseConfig, ExercisePerformance, WeightUnit } from "@/lib/domain/types";
import { displayToKg, kgToDisplay } from "@/lib/domain/units";
import { toLoggedSet } from "@/lib/data/types";
import { cn, formatDuration } from "@/lib/utils";
import { comparisonText, formatSetShort, formatSetsCompact, loadColumnLabel } from "./format";
import { MenuCheckboxItem } from "./menu-checkbox-item";
import { NumberField } from "./number-field";
import { PreviousSessionSheet } from "./previous-session-sheet";
import { useShowRir } from "./rir-visibility";
import type { WExercise, WSet } from "./types";

interface Props {
  item: WExercise;
  config: ExerciseConfig;
  history: ExercisePerformance[];
  recommendation: Recommendation | null;
  recommendationDismissed: boolean;
  unit: WeightUnit;
  isFirst: boolean;
  isLast: boolean;
  onSetChange: (setId: string, patch: Partial<WSet>) => void;
  onCompleteSet: (setId: string) => void;
  onAddSet: (kind: "working" | "warmup") => void;
  onRemoveSet: (setId: string) => void;
  onToggleKind: (setId: string) => void;
  onNotes: (notes: string) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onReplace: () => void;
  onDismissRecommendation: () => void;
}

// Phone cards stack each set's previous result under its inputs; from a ~450px card
// width up, the original single-row table returns. Class strings stay literal for Tailwind.
const SET_GRID = {
  rir: "grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_48px] @md:grid-cols-[44px_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.7fr)_48px]",
  noRir: "grid-cols-[44px_minmax(0,1fr)_minmax(0,1fr)_48px] @md:grid-cols-[44px_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)_48px]",
};
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const iconButton = cn("grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted", focusRing);

export function ExerciseCard(p: Props) {
  const { item, config: ex, history, unit } = p;
  const [showPrev, setShowPrev] = useState(false);
  const [showNotes, setShowNotes] = useState(!!item.notes);
  const [showWhy, setShowWhy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const [showRir, setShowRir] = useShowRir();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const uid = useId();
  const ids = { title: `${uid}-title`, body: `${uid}-body`, why: `${uid}-why`, tech: `${uid}-tech` };
  const setGrid = showRir ? SET_GRID.rir : SET_GRID.noRir;

  function reportFieldError(key: string, message: string | null) {
    setFieldErrors((cur) => {
      if ((cur[key] ?? null) === message) return cur;
      const next = { ...cur };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }

  const prev = history.find((h) => workingSets(h.sets).length > 0) ?? null;
  const prevSets = prev?.sets ?? [];
  const rx = item.prescribed;
  const prevSummary = prev ? summarisePrevious(prevSets, prev.prescription?.sets ?? null) : null;
  const assisted = ex.loadType === "assisted";
  const bodyLoad = ex.loadType === "bodyweight" || ex.loadType === "weighted_bodyweight";
  const rec = p.recommendation;

  const done = item.sets.filter((s) => s.completed && s.kind === "working").length;
  const total = item.sets.filter((s) => s.kind === "working").length;
  let workingIdx = -1;

  return (
    <section aria-labelledby={ids.title} className="@container rounded-xl border bg-card shadow-card">
      {/* Header */}
      <div className="flex items-start gap-1 pb-1 pl-4 pr-2 pt-4 md:pl-5 md:pr-3">
        <button
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : ids.body}
          className={cn("-ml-1 mr-1 min-h-11 min-w-0 flex-1 rounded-md pl-1 text-left", focusRing)}
          onClick={() => setCollapsed((c) => !c)}
        >
          <h2 id={ids.title} className="flex items-center gap-2 text-[17px] font-semibold leading-snug tracking-tight">
            <span className="line-clamp-2">{ex.name}</span>
            {done === total && total > 0 && <Check className="size-4 shrink-0 text-positive" strokeWidth={2.5} />}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground tabular">
            {rx.sets ?? total} × {rx.rep_min}–{rx.rep_max}
            {rx.rest_s ? ` · ${formatDuration(rx.rest_s * 1000)} rest` : ""}
            {rx.target_rir != null ? ` · RIR ${rx.target_rir}` : ""}
            {rx.optional ? " · optional" : ""}
            {collapsed && ` · ${done}/${total} done`}
          </p>
        </button>
        <button aria-label={`Previous sessions: ${ex.name}`} aria-haspopup="dialog" onClick={() => setShowPrev(true)} className={cn("-mt-1", iconButton)}>
          <History className="size-[18px]" strokeWidth={1.8} />
        </button>
        <Menu>
          <MenuTrigger aria-label={`Exercise options: ${ex.name}`} className={cn("-mt-1", iconButton)}>
            <MoreHorizontal className="size-[18px]" />
          </MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => setShowPrev(true)}><History /> Previous sessions</MenuItem>
            <MenuItem onSelect={() => setShowNotes(true)}><NotebookPen /> Exercise note</MenuItem>
            <MenuItem onSelect={() => p.onAddSet("warmup")}><Plus /> Add warm-up set</MenuItem>
            <MenuCheckboxItem checked={showRir} onCheckedChange={(v) => setShowRir(v === true)}>
              Show RIR inputs
            </MenuCheckboxItem>
            <MenuSeparator />
            <MenuItem onSelect={p.onReplace}><Repeat /> Replace exercise</MenuItem>
            <MenuItem disabled={p.isFirst} onSelect={() => p.onMove(-1)}><ArrowUp /> Move up</MenuItem>
            <MenuItem disabled={p.isLast} onSelect={() => p.onMove(1)}><ArrowDown /> Move down</MenuItem>
            <MenuSeparator />
            <MenuItem destructive onSelect={p.onRemove}><Trash2 /> Remove exercise</MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {!collapsed && (
        <div id={ids.body}>
          {/* Previous performance + recommendation */}
          <div className="space-y-2 px-4 md:px-5">
            {prev ? (
              <button aria-haspopup="dialog" onClick={() => setShowPrev(true)} className={cn("-mx-1 block min-h-11 w-[calc(100%+0.5rem)] rounded-md px-1 py-1.5 text-left text-[13px] text-muted-foreground", focusRing)}>
                <span className="font-medium text-foreground/80">Last time</span>{" "}
                <span className="tabular">{formatSetsCompact(workingSets(prevSets), ex.loadType, unit)}</span>
                {prevSummary?.incomplete && <span> · {prevSummary.completedWorkingSets}/{prevSummary.prescribedSets} sets</span>}
                {item.substituted_for && <span> · substituted</span>}
              </button>
            ) : (
              <p className="text-[13px] text-muted-foreground">First time logging this exercise. Pick a load you could lift for about {Math.max(rx.rep_min ?? 1, (rx.rep_max ?? 10) - 2)} reps with 2 in reserve.</p>
            )}

            {rec && rec.action !== "first_time" && !p.recommendationDismissed && (
              <div className="rounded-md bg-accent-soft px-3 py-2.5">
                <div className="flex items-start">
                  <p className="flex-1 pr-1 text-[13.5px] font-medium leading-snug text-accent">{headline(rec, ex, unit)}</p>
                  <button
                    aria-label="Why this suggestion"
                    aria-expanded={showWhy}
                    aria-controls={showWhy ? ids.why : undefined}
                    onClick={() => setShowWhy((v) => !v)}
                    className={cn("-my-3 grid size-11 shrink-0 place-items-center rounded-full text-accent/70 hover:text-accent", focusRing)}
                  >
                    <Info className="size-4" />
                  </button>
                  <button
                    aria-label="Dismiss suggestion"
                    onClick={p.onDismissRecommendation}
                    className={cn("-my-3 -mr-2.5 grid size-11 shrink-0 place-items-center rounded-full text-accent/70 hover:text-accent", focusRing)}
                  >
                    <X className="size-4" />
                  </button>
                </div>
                {showWhy && (
                  <ul id={ids.why} className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-foreground/70">
                    {rec.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Set table */}
          <div className="mt-2 px-1 @md:px-2 md:px-3">
            <div aria-hidden className={cn("grid items-center gap-1.5 px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground @md:px-2", setGrid)}>
              <span className="text-center">Set</span>
              <span className="hidden @md:block">Previous</span>
              <span className="text-center">{loadColumnLabel(ex.loadType, unit)}</span>
              <span className="text-center">Reps</span>
              {showRir && <span className="text-center">RIR</span>}
              <span />
            </div>
            {item.sets.map((s) => {
              const isWarm = s.kind === "warmup";
              if (!isWarm) workingIdx++;
              const idx = workingIdx;
              const prevSet = isWarm ? null : previousCounterpart(prevSets, idx);
              const targetReps = isWarm ? null : rec?.targetReps?.[idx] ?? prevSet?.reps ?? null;
              const suggestedLoad = isWarm ? null : rec?.targetLoadKg ?? (assisted ? prevSet?.assistanceKg : prevSet?.weightKg) ?? null;
              const loadVal = assisted ? s.assistance_kg : s.weight_kg;
              const showLoad = loadVal ?? (s.completed ? null : suggestedLoad);
              const isSuggested = loadVal == null && showLoad != null;
              const cmp = s.completed && !isWarm ? compareSet(toLoggedSet(s), prevSet, ex) : null;
              const cmpText = cmp ? comparisonText(cmp, unit, ex.loadType) : null;
              const setName = isWarm ? "Warm-up set" : `Set ${idx + 1}`;
              const loadName = ex.loadType === "assisted" ? "assistance" : "load";
              const rowErrors = [
                fieldErrors[`${s.id}:load`] && `Load: ${fieldErrors[`${s.id}:load`]}`,
                fieldErrors[`${s.id}:reps`] && `Reps: ${fieldErrors[`${s.id}:reps`]}`,
                fieldErrors[`${s.id}:rir`] && `RIR: ${fieldErrors[`${s.id}:rir`]}`,
              ].filter(Boolean);

              return (
                <div
                  key={s.id}
                  className={cn(
                    "grid items-center gap-x-1.5 gap-y-0.5 rounded-md px-1.5 py-1 transition-colors @md:gap-y-1.5 @md:px-2",
                    setGrid,
                    s.completed && "bg-positive/[0.06]",
                  )}
                >
                  <Menu>
                    <MenuTrigger
                      aria-label={`${setName} options`}
                      className={cn("h-11 rounded-sm text-center text-[14px] font-semibold tabular hover:bg-muted", focusRing, isWarm ? "text-negative" : "text-muted-foreground")}
                    >
                      {isWarm ? "W" : idx + 1}
                    </MenuTrigger>
                    <MenuContent align="start">
                      <MenuItem onSelect={() => p.onToggleKind(s.id)}>{isWarm ? "Mark as working set" : "Mark as warm-up"}</MenuItem>
                      <MenuItem destructive onSelect={() => p.onRemoveSet(s.id)}><Trash2 /> Delete set</MenuItem>
                    </MenuContent>
                  </Menu>
                  <div
                    className={cn(
                      "col-[2/-1] row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-2 pb-0.5 leading-tight @md:col-[2/3] @md:row-start-1 @md:block @md:pb-0",
                      !prevSet && !cmpText && "hidden @md:block",
                    )}
                  >
                    <p className="truncate text-[13px] text-muted-foreground tabular">
                      <span className="@md:hidden">Previous </span>
                      {prevSet ? formatSetShort(prevSet, ex.loadType, unit) : "—"}
                    </p>
                    {cmpText && (
                      <p className={cn("text-[11px] font-medium leading-tight @md:line-clamp-2", cmpText.tone === "positive" && "text-positive", cmpText.tone === "negative" && "text-negative", cmpText.tone === "neutral" && "text-muted-foreground")}>
                        {cmpText.text}
                      </p>
                    )}
                  </div>
                  <NumberField
                    ariaLabel={`${setName} ${loadName}`}
                    onErrorChange={(m) => reportFieldError(`${s.id}:load`, m)}
                    value={showLoad != null ? kgToDisplay(showLoad, unit) : null}
                    suggested={isSuggested}
                    placeholder={bodyLoad ? "0" : "–"}
                    max={unit === "kg" ? 1000 : 2200}
                    onCommit={(v) => p.onSetChange(s.id, assisted ? { assistance_kg: v == null ? null : displayToKg(v, unit) } : { weight_kg: v == null ? null : displayToKg(v, unit) })}
                  />
                  <NumberField
                    ariaLabel={`${setName} reps`}
                    onErrorChange={(m) => reportFieldError(`${s.id}:reps`, m)}
                    value={s.reps}
                    integer
                    placeholder={targetReps != null ? String(targetReps) : String(rx.rep_max ?? "")}
                    max={200}
                    onCommit={(v) => p.onSetChange(s.id, { reps: v })}
                  />
                  {showRir && (
                    <NumberField
                      ariaLabel={`${setName} reps in reserve`}
                      onErrorChange={(m) => reportFieldError(`${s.id}:rir`, m)}
                      value={s.rir}
                      placeholder="–"
                      max={10}
                      className="text-[14px]"
                      onCommit={(v) => p.onSetChange(s.id, { rir: v })}
                    />
                  )}
                  <button
                    aria-label={s.completed ? `Mark ${setName.toLowerCase()} not done` : `Complete ${setName.toLowerCase()}`}
                    aria-pressed={s.completed}
                    onClick={() => p.onCompleteSet(s.id)}
                    className={cn(
                      "grid h-11 w-12 place-items-center rounded-md transition-all active:scale-95",
                      focusRing,
                      s.completed ? "bg-positive text-white dark:text-black" : "bg-subtle text-muted-foreground hover:bg-subtle/70",
                    )}
                  >
                    <Check className="size-5" strokeWidth={2.6} />
                  </button>
                  {rowErrors.length > 0 && (
                    <p aria-hidden className="col-span-full px-1 pb-0.5 text-[12px] leading-snug text-negative">{rowErrors.join(" ")}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-1 px-3 pb-3 pt-1 md:px-4">
            <button onClick={() => p.onAddSet("working")} className={cn("flex h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] @md:px-3 font-medium text-muted-foreground hover:bg-muted", focusRing)}>
              <Plus className="size-4" /> Add set
            </button>
            {!showNotes && (
              <button onClick={() => setShowNotes(true)} className={cn("flex h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] @md:px-3 font-medium text-muted-foreground hover:bg-muted", focusRing)}>
                <NotebookPen className="size-4" /> Note
              </button>
            )}
            {(item.exercise.instructions || item.exercise.notes) && (
              <button
                aria-expanded={showTech}
                aria-controls={showTech ? ids.tech : undefined}
                onClick={() => setShowTech((v) => !v)}
                className={cn("ml-auto flex h-11 items-center gap-1 whitespace-nowrap rounded-md px-2.5 text-[13px] @md:px-3 font-medium text-muted-foreground hover:bg-muted", focusRing)}
              >
                Technique <ChevronDown className={cn("size-3.5 transition-transform", showTech && "rotate-180")} />
              </button>
            )}
          </div>
          {showTech && (
            <div id={ids.tech} className="mx-4 mb-3 space-y-1 rounded-md bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground md:mx-5">
              {item.exercise.instructions && <p>{item.exercise.instructions}</p>}
              {item.exercise.notes && <p>{item.exercise.notes}</p>}
            </div>
          )}
          {showNotes && (
            <div className="px-4 pb-4 md:px-5">
              <Textarea
                aria-label={`Notes: ${ex.name}`}
                placeholder="Notes for this exercise (seat height, grip, how it felt…)"
                defaultValue={item.notes ?? ""}
                onChange={(e) => p.onNotes(e.target.value)}
                className="min-h-[60px] text-[14px]"
              />
            </div>
          )}
        </div>
      )}

      <PreviousSessionSheet open={showPrev} onOpenChange={setShowPrev} ex={ex} history={history} unit={unit} />
    </section>
  );
}

