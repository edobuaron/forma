"use client";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, Copy, CornerDownRight, Flame, History, Info, Link2, MoreHorizontal, NotebookPen, Plus, Repeat, Trash2, X,
} from "lucide-react";
import { useId, useState } from "react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown";
import { Textarea } from "@/components/ui/input";
import { compareSet, previousCounterpart, previousFor, summarisePrevious } from "@/lib/domain/comparison";
import { headline, type Recommendation } from "@/lib/domain/progression";
import { workingSets } from "@/lib/domain/sets";
import { dropSegmentsDone } from "@/lib/domain/drops";
import {
  attachmentRelation, compatibleHistory, doneWorkingSets, performedSets, sessionMode, setDone, setPerformed, sideAsSet, sideLabel,
  sideShort, sideTrackingSuitable, SIDES,
} from "@/lib/domain/sides";
import type { ExerciseConfig, ExercisePerformance, LoggedSet, Side, WeightUnit } from "@/lib/domain/types";
import { displayToKg, kgToDisplay } from "@/lib/domain/units";
import { canToggleKind, dropSegmentsOf, plannedSets } from "@/lib/data/set-rows";
import { toAttachmentRef, toLoggedSet } from "@/lib/data/types";
import { cn, formatDuration } from "@/lib/utils";
import { ExerciseIcon } from "@/components/ui/category";
import { exerciseCategory } from "@/lib/category";
import { AttachmentChip } from "./attachment-picker";
import { comparisonText, formatPerformance, formatSetShort, loadColumnLabel } from "./format";
import { MenuCheckboxItem } from "./menu-checkbox-item";
import { NumberField } from "./number-field";
import { PreviousSessionSheet } from "./previous-session-sheet";
import { useShowRir } from "./rir-visibility";
import type { SidePatch, WExercise, WSet } from "./types";

interface Props {
  item: WExercise;
  config: ExerciseConfig;
  history: ExercisePerformance[];
  recommendation: Recommendation | null;
  recommendationDismissed: boolean;
  unit: WeightUnit;
  isFirst: boolean;
  isLast: boolean;
  /** The next set to do in the whole workout. */
  activeSetId: string | null;
  onSetChange: (setId: string, patch: Partial<WSet>) => void;
  onCompleteSet: (setId: string) => void;
  onSideChange: (setId: string, side: Side, patch: SidePatch) => void;
  onCompleteSide: (setId: string, side: Side) => void;
  onCopyLeftToRight: (setId: string) => void;
  onToggleSides: () => void;
  onPickAttachment: () => void;
  onAddSet: (kind: "working" | "warmup") => void;
  /** Add a drop segment after a working set (and its earlier segments). */
  onAddDrop: (parentId: string) => void;
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
const footerButton = cn("flex h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] @md:px-3 font-medium text-muted-foreground hover:bg-muted", focusRing);
const activeRow = "shadow-[inset_3px_0_0_var(--accent)] bg-accent-soft";
const dropRail = "ml-5 rounded-l-none border-l-2 border-dashed border-accent/40 @md:ml-6";
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
  const [removing, setRemoving] = useState(false);
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

  // The latest session in any mode is shown for context; only compatible sessions are compared.
  const attachment = toAttachmentRef(item);
  const compatible = compatibleHistory(history, attachment);
  const latest = history.find((h) => performedSets(h.sets, ex).length > 0) ?? null;
  const prev = previousFor(compatible, "together", ex);
  const prevSets = prev?.sets ?? [];
  const prevSide = { left: previousFor(compatible, "left", ex), right: previousFor(compatible, "right", ex) };
  const rx = item.prescribed;
  const latestDone = latest ? doneWorkingSets(latest.sets) : 0;
  const prevSummary = latest ? summarisePrevious([], latest.prescription?.sets ?? null) : null;
  const latestMode = latest ? sessionMode(latest.sets) : null;
  const relation = latest ? attachmentRelation(latest.attachment, attachment) : "unrecorded";
  const showAttachment = item.exercise.equipment === "cable" || !!attachment.state;
  const canTrackSides = item.track_sides || sideTrackingSuitable(item.exercise) || item.sets.some((x) => x.sided);
  const assisted = ex.loadType === "assisted";
  const bodyLoad = ex.loadType === "bodyweight" || ex.loadType === "weighted_bodyweight";
  const rec = p.recommendation;

  const logged = item.sets.map(toLoggedSet);
  const done = doneWorkingSets(logged);
  const total = plannedSets(rx, item.sets);
  const complete = total > 0 && done >= total;
  const warmups = item.sets.filter((x) => x.kind === "warmup").length;
  const drops = item.sets.filter((x) => x.kind === "drop").length;
  const dropsDone = dropSegmentsDone(logged);
  let workingIdx = -1;
  let sidedIdx = -1;
  // Working-set number of each parent, and the running segment number within it.
  const parentNo = new Map<string, number>();
  const dropNo = new Map<string, number>();

  const hasActive = item.sets.some((s) => s.id === p.activeSetId);
  return (
    <section aria-labelledby={ids.title} className={cn("@container rounded-xl border bg-card shadow-card transition-[border-color,box-shadow]", complete && "border-done/35", hasActive && "border-accent/45 ring-1 ring-accent/20")}>
      {/* Header */}
      <div className="flex items-start gap-1 pb-1 pl-4 pr-2 pt-4 md:pl-5 md:pr-3">
        <ExerciseIcon category={exerciseCategory(item.exercise.primary_muscles)} equipment={item.exercise.equipment} className="mr-2 mt-0.5 hidden @sm:grid" />
        <button
          aria-expanded={!collapsed}
          aria-controls={collapsed ? undefined : ids.body}
          className={cn("-ml-1 mr-1 min-h-11 min-w-0 flex-1 rounded-md pl-1 text-left", focusRing)}
          onClick={() => setCollapsed((c) => !c)}
        >
          <h2 id={ids.title} className="flex items-center gap-2 text-[18px] font-bold leading-snug tracking-[-0.02em]">
            <span className="line-clamp-2">{ex.name}</span>
            <span className={cn("ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium tabular", complete ? "bg-done/15 text-done" : "bg-subtle text-muted-foreground")}>
              {complete && <Check aria-hidden className="size-3.5" strokeWidth={2.75} />}
              {done}/{total}<span className="sr-only"> planned sets done{complete ? ", complete" : ""}</span>
            </span>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground tabular">
            {rx.sets ?? total} × {rx.rep_min}–{rx.rep_max}
            {rx.rest_s ? ` · ${formatDuration(rx.rest_s * 1000)} rest` : ""}
            {rx.target_rir != null ? ` · RIR ${rx.target_rir}` : ""}
            {rx.optional ? " · optional" : ""}
            {item.track_sides && " · L/R"}
          </p>
          {(warmups > 0 || drops > 0) && (
            <p className="text-[12.5px] text-muted-foreground tabular">
              {warmups > 0 && <span>{warmups} warm-up{warmups === 1 ? "" : "s"}, not counted</span>}
              {warmups > 0 && drops > 0 && " · "}
              {drops > 0 && <span>{dropsDone}/{drops} drop{drops === 1 ? "" : "s"} done</span>}
            </p>
          )}
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
            {canTrackSides && (
              <MenuCheckboxItem checked={item.track_sides} onCheckedChange={() => p.onToggleSides()}>
                Track sides separately
              </MenuCheckboxItem>
            )}
            <MenuItem onSelect={p.onPickAttachment}><Link2 /> Attachment…</MenuItem>
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
            {showAttachment && (
              <div className="-my-1.5 flex flex-wrap items-center gap-x-2">
                <AttachmentChip value={attachment} onClick={p.onPickAttachment} />
              </div>
            )}
            {latest ? (
              <button aria-haspopup="dialog" onClick={() => setShowPrev(true)} className={cn("-mx-1 block min-h-11 w-[calc(100%+0.5rem)] rounded-md px-1 py-1.5 text-left text-[13px] text-muted-foreground", focusRing)}>
                <span className="font-semibold text-foreground/85">Last time</span>{" "}
                <span className="tabular">{formatPerformance(latest.sets, ex.loadType, unit, workingSets(latest.sets, ex))}</span>
                {dropSegmentsDone(latest.sets) > 0 && <span> · {dropSegmentsDone(latest.sets)} drop{dropSegmentsDone(latest.sets) === 1 ? "" : "s"}</span>}
                {prevSummary?.prescribedSets != null && latestDone < prevSummary.prescribedSets && <span> · {latestDone}/{prevSummary.prescribedSets} sets</span>}
                {latest.attachment?.state && <span> · {latest.attachment.state === "none" ? "no attachment" : latest.attachment.name}</span>}
                {relation === "different" && <span className="text-foreground/80"> · different attachment, not compared</span>}
                {relation === "unknown" && (
                  <span className="text-foreground/80"> · {latest.attachment?.state ? "no attachment recorded today" : "attachment not recorded"}, not compared</span>
                )}
                {latestMode && latestMode !== "mixed" && (latestMode === "sides") !== item.track_sides && (
                  <span className="text-foreground/80"> · {latestMode === "sides" ? "logged per side" : "logged together"}, not compared</span>
                )}
                {item.substituted_for && <span> · substituted</span>}
              </button>
            ) : (
              <p className="text-[13px] text-muted-foreground">First time logging this exercise. Pick a load you could lift for about {Math.max(rx.rep_min ?? 1, (rx.rep_max ?? 10) - 2)} reps with 2 in reserve.</p>
            )}

            {/* first_time with a history means nothing comparable (other attachment or mode): say what to do. */}
            {rec && (rec.action !== "first_time" || latest) && !p.recommendationDismissed && (
              <div className="rounded-md border-l-[3px] border-accent bg-accent-soft px-3 py-2.5">
                <div className="flex items-start">
                  <p className="flex-1 pr-1 text-[13.5px] font-semibold leading-snug text-accent">{headline(rec, ex, unit)}</p>
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
            <div aria-hidden className={cn("grid items-center gap-1.5 px-1.5 pb-1 text-[11.5px] font-semibold text-muted-foreground @md:px-2", setGrid)}>
              <span className="text-center">Set</span>
              <span className="hidden @md:block">Previous</span>
              <span className="text-center">{loadColumnLabel(ex.loadType, unit)}</span>
              <span className="text-center">Reps</span>
              {showRir && <span className="text-center">RIR</span>}
              <span />
            </div>
            {item.sets.map((s, si) => {
              const isWarm = s.kind === "warmup";
              const isDrop = s.kind === "drop";
              if (s.kind === "working") workingIdx++;
              if (s.kind === "working" && s.sided) sidedIdx++;
              const idx = workingIdx;
              if (s.kind === "working") parentNo.set(s.id, idx + 1);
              const parentId = isDrop ? s.drop_parent_id ?? "" : s.id;
              const dropK = isDrop ? (dropNo.get(parentId) ?? 0) + 1 : 0;
              if (isDrop) dropNo.set(parentId, dropK);
              const setName = isWarm ? "Warm-up set" : isDrop ? `Set ${parentNo.get(parentId) ?? "?"} drop ${dropK}` : `Set ${idx + 1}`;
              const active = s.id === p.activeSetId;
              const hasDrops = s.kind === "working" && dropSegmentsOf(item.sets, s.id).length > 0;
              const nextSet = item.sets[si + 1];
              const lastOfGroup = (isDrop || hasDrops) && !(nextSet?.kind === "drop" && nextSet.drop_parent_id === parentId);
              const setMenu = (className?: string) => (
                <Menu>
                  <MenuTrigger
                    aria-label={`${setName} options`}
                    className={cn("h-11 rounded-sm text-center text-[14px] font-semibold tabular hover:bg-muted", focusRing, isWarm ? "text-pending" : isDrop ? "text-accent" : "text-muted-foreground", className)}
                  >
                    {isWarm ? "W" : isDrop ? <span className="inline-flex items-center"><CornerDownRight aria-hidden className="size-3.5" />{dropK}</span> : idx + 1}
                  </MenuTrigger>
                  <MenuContent align="start">
                    {isDrop ? (
                      <MenuItem destructive onSelect={() => p.onRemoveSet(s.id)}><Trash2 /> Remove drop</MenuItem>
                    ) : (
                      <>
                        {s.kind === "working" && <MenuItem onSelect={() => p.onAddDrop(s.id)}><CornerDownRight /> {hasDrops ? "Add another drop" : "Make it a drop set"}</MenuItem>}
                        <MenuItem disabled={!canToggleKind(item.sets, s.id)} onSelect={() => p.onToggleKind(s.id)}>
                          {isWarm ? "Mark as working set" : hasDrops ? "Mark as warm-up (remove drops first)" : "Mark as warm-up"}
                        </MenuItem>
                        <MenuItem destructive onSelect={() => p.onRemoveSet(s.id)}><Trash2 /> {hasDrops ? "Remove set and its drops" : "Remove set"}</MenuItem>
                      </>
                    )}
                  </MenuContent>
                </Menu>
              );
              const addDropButton = lastOfGroup && !removing && (
                <button
                  onClick={() => p.onAddDrop(parentId)}
                  className={cn("mb-1 flex h-9 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-accent hover:bg-muted", dropRail, focusRing)}
                >
                  <Plus className="size-3.5" /> Drop<span className="sr-only"> after {setName.replace(/ drop \d+$/, "").toLowerCase()}</span>
                </button>
              );
              const removeButton = (
                <button
                  aria-label={`Remove ${setName.toLowerCase()}`}
                  onClick={() => p.onRemoveSet(s.id)}
                  className={cn("grid h-11 w-12 place-items-center rounded-md border border-dashed border-destructive/50 text-destructive hover:bg-destructive/10", focusRing)}
                >
                  <Trash2 className="size-[18px]" />
                </button>
              );

              if (s.sided) {
                const set = toLoggedSet(s);
                const pi = sidedIdx;
                const partial = setPerformed(set) && !setDone(set);
                return (
                  <div key={s.id}>
                  <div role="group" aria-label={`${setName}, left and right`} aria-current={active ? "step" : undefined}
                    className={cn("mt-0.5 rounded-md pb-0.5 transition-colors", isDrop && dropRail, active && activeRow)}>
                    <div className="flex items-center gap-1 px-1.5 @md:px-2">
                      {setMenu("w-11 shrink-0")}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                        {isDrop ? `Drop ${dropK} · left / right` : "Left / right"}
                        {partial && <span className="text-pending"> · {SIDES.find((sd) => !set.sides![sd].completed) === "left" ? "left" : "right"} side to go</span>}
                      </span>
                      {removing ? removeButton : (
                        <button
                          onClick={() => p.onCopyLeftToRight(s.id)}
                          aria-label={`${setName}: copy left values to right`}
                          disabled={s.left_reps == null && s.left_weight_kg == null && s.left_assistance_kg == null}
                          className={cn("flex h-11 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40", focusRing)}
                        >
                          <Copy className="size-3.5" /> L → R
                        </button>
                      )}
                    </div>
                    {SIDES.map((side) => (
                      <SideRow
                        key={side} side={side} set={s} setName={setName} plain={isWarm || isDrop} showRir={showRir} setGrid={setGrid}
                        ex={ex} unit={unit} rx={rx}
                        prev={isWarm || isDrop || !prevSide[side] ? null : previousCounterpart(prevSide[side]!.sets, pi, ex)}
                        rec={p.recommendation?.sides?.[side] ?? null} index={pi}
                        reportFieldError={reportFieldError} fieldErrors={fieldErrors}
                        onChange={(patch) => p.onSideChange(s.id, side, patch)}
                        onComplete={() => p.onCompleteSide(s.id, side)}
                      />
                    ))}
                  </div>
                  {addDropButton}
                  </div>
                );
              }

              // Warm-ups and drops get no suggestion and no comparison: their numbers are whatever was done.
              const plain = isWarm || isDrop;
              const prevSet = plain ? null : previousCounterpart(prevSets, idx, ex);
              const targetReps = plain ? null : rec?.targetReps?.[idx] ?? prevSet?.reps ?? null;
              const suggestedLoad = plain ? null : rec?.targetLoadKg ?? (assisted ? prevSet?.assistanceKg : prevSet?.weightKg) ?? null;
              const loadVal = assisted ? s.assistance_kg : s.weight_kg;
              const showLoad = loadVal ?? (s.completed ? null : suggestedLoad);
              const isSuggested = loadVal == null && showLoad != null;
              const cmp = s.completed && !plain ? compareSet(toLoggedSet(s), prevSet, ex) : null;
              const cmpText = cmp ? comparisonText(cmp, unit, ex.loadType) : null;
              const loadName = ex.loadType === "assisted" ? "assistance" : "load";
              const rowErrors = [
                fieldErrors[`${s.id}:load`] && `Load: ${fieldErrors[`${s.id}:load`]}`,
                fieldErrors[`${s.id}:reps`] && `Reps: ${fieldErrors[`${s.id}:reps`]}`,
                fieldErrors[`${s.id}:rir`] && `RIR: ${fieldErrors[`${s.id}:rir`]}`,
              ].filter(Boolean);

              return (
                <div key={s.id}>
                <div
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "grid items-center gap-x-1.5 gap-y-0.5 rounded-md px-1.5 py-1 transition-colors @md:gap-y-1.5 @md:px-2",
                    setGrid,
                    isDrop && dropRail,
                    s.completed && "bg-done/[0.07]",
                    active && activeRow,
                  )}
                >
                  {setMenu()}
                  {isDrop ? (
                    <p className="col-[2/-1] row-start-2 hidden text-[12.5px] text-muted-foreground @md:col-[2/3] @md:row-start-1 @md:block">Drop {dropK} · not compared</p>
                  ) : isWarm ? (
                    <p className="col-[2/-1] row-start-2 hidden text-[12.5px] text-muted-foreground @md:col-[2/3] @md:row-start-1 @md:block">Warm-up · not counted</p>
                  ) : (
                    <PreviousCell prevText={prevSet ? formatSetShort(prevSet, ex.loadType, unit) : null} cmpText={cmpText} />
                  )}
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
                    placeholder={isDrop ? "–" : targetReps != null ? String(targetReps) : String(rx.rep_max ?? "")}
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
                  {removing ? removeButton : (
                    <CompleteButton done={s.completed} label={setName} onClick={() => p.onCompleteSet(s.id)} />
                  )}
                  {rowErrors.length > 0 && (
                    <p aria-hidden className="col-span-full px-1 pb-0.5 text-[12px] leading-snug text-negative">{rowErrors.join(" ")}</p>
                  )}
                </div>
                {addDropButton}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-x-1 px-3 pb-3 pt-1 md:px-4">
            <button onClick={() => p.onAddSet("working")} className={footerButton}>
              <Plus className="size-4" /> Add set
            </button>
            {!removing && (
              <button onClick={() => p.onAddSet("warmup")} className={footerButton}>
                <Flame className="size-4" /> Warm-up<span className="sr-only"> set</span>
              </button>
            )}
            {item.sets.length > 0 && (
              <button onClick={() => setRemoving((r) => !r)} aria-pressed={removing} className={cn(footerButton, removing && "bg-muted text-foreground")}>
                {removing ? <><Check className="size-4" /> Done</> : <><Trash2 className="size-4" /> Remove</>}
              </button>
            )}
            {!showNotes && !removing && (
              <button onClick={() => setShowNotes(true)} className={footerButton}>
                <NotebookPen className="size-4" /> Note
              </button>
            )}
            {(item.exercise.instructions || item.exercise.notes) && (
              <button
                aria-expanded={showTech}
                aria-controls={showTech ? ids.tech : undefined}
                onClick={() => setShowTech((v) => !v)}
                className={cn(footerButton, "ml-auto gap-1")}
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


function CompleteButton({ done, label, onClick }: { done: boolean; label: string; onClick: () => void }) {
  return (
    <button
      aria-label={done ? `Mark ${label.toLowerCase()} not done` : `Complete ${label.toLowerCase()}`}
      aria-pressed={done}
      onClick={onClick}
      className={cn(
        "grid h-11 w-12 place-items-center rounded-md transition-[background-color,transform] active:scale-95 motion-reduce:active:scale-100",
        focusRing,
        done ? "bg-done text-background" : "border border-input bg-card text-muted-foreground hover:border-done/60 hover:text-done",
      )}
    >
      <Check className={cn("size-5", done && "animate-pop")} strokeWidth={done ? 3 : 2.4} />
    </button>
  );
}

/** Previous set and comparison: beside the inputs on wide cards, underneath on phones. */
function PreviousCell({ prevText, cmpText, prefix = "Previous" }: { prevText: string | null; cmpText: ReturnType<typeof comparisonText>; prefix?: string }) {
  return (
    <div
      className={cn(
        "col-[2/-1] row-start-2 flex min-w-0 flex-wrap items-baseline gap-x-2 pb-0.5 leading-tight @md:col-[2/3] @md:row-start-1 @md:block @md:pb-0",
        !prevText && !cmpText && "hidden @md:block",
      )}
    >
      <p className="truncate text-[13px] text-muted-foreground tabular">
        <span className="@md:hidden">{prefix} </span>
        {prevText ?? "—"}
      </p>
      {cmpText && (
        <p className={cn("text-[11px] font-medium leading-tight @md:line-clamp-2", cmpText.tone === "positive" && "text-positive", cmpText.tone === "negative" && "text-negative", cmpText.tone === "neutral" && "text-muted-foreground")}>
          {cmpText.text}
        </p>
      )}
    </div>
  );
}

/** One side of a left/right set: its own load, reps, RIR and completion, compared with the same side last time. */
function SideRow({ side, set: s, setName, plain, showRir, setGrid, ex, unit, rx, prev, rec, index, reportFieldError, fieldErrors, onChange, onComplete }: {
  side: Side; set: WSet; setName: string; plain: boolean; showRir: boolean; setGrid: string;
  ex: ExerciseConfig; unit: WeightUnit; rx: WExercise["prescribed"]; prev: LoggedSet | null; rec: Recommendation | null; index: number;
  reportFieldError: (key: string, m: string | null) => void; fieldErrors: Record<string, string>;
  onChange: (patch: SidePatch) => void; onComplete: () => void;
}) {
  const assisted = ex.loadType === "assisted";
  const bodyLoad = ex.loadType === "bodyweight" || ex.loadType === "weighted_bodyweight";
  const v = sideAsSet(toLoggedSet(s), side);
  const done = v.completed;
  const loadVal = assisted ? v.assistanceKg : v.weightKg;
  const suggested = plain ? null : rec?.targetLoadKg ?? (assisted ? prev?.assistanceKg : prev?.weightKg) ?? null;
  const showLoad = loadVal ?? (done ? null : suggested);
  const targetReps = plain ? null : rec?.targetReps?.[index] ?? prev?.reps ?? null;
  const cmp = done && !plain ? comparisonText(compareSet(v, prev, ex), unit, ex.loadType) : null;
  const name = `${setName} ${sideLabel[side].toLowerCase()}`;
  const key = `${s.id}:${side}`;
  const errors = ["load", "reps", "rir"].map((f) => fieldErrors[`${key}:${f}`] && `${f === "rir" ? "RIR" : f[0].toUpperCase() + f.slice(1)}: ${fieldErrors[`${key}:${f}`]}`).filter(Boolean);
  return (
    <div className={cn("grid items-center gap-x-1.5 gap-y-0.5 rounded-md px-1.5 py-0.5 transition-colors @md:gap-y-1.5 @md:px-2", setGrid, done && "bg-done/[0.07]")}>
      <span className={cn(
        "mx-auto grid h-7 w-8 place-items-center rounded-full text-[12px] font-semibold",
        side === "left" ? "bg-subtle text-foreground/80" : "border text-foreground/80",
      )}>
        <span aria-hidden>{sideShort[side]}</span><span className="sr-only">{sideLabel[side]}</span>
      </span>
      <PreviousCell prefix={`${sideLabel[side]} last time`} prevText={prev ? formatSetShort(prev, ex.loadType, unit) : null} cmpText={cmp} />
      <NumberField
        ariaLabel={`${name} ${assisted ? "assistance" : "load"}`}
        onErrorChange={(m) => reportFieldError(`${key}:load`, m)}
        value={showLoad != null ? kgToDisplay(showLoad, unit) : null}
        suggested={loadVal == null && showLoad != null}
        placeholder={bodyLoad ? "0" : "–"}
        max={unit === "kg" ? 1000 : 2200}
        onCommit={(x) => onChange(assisted ? { assistance_kg: x == null ? null : displayToKg(x, unit) } : { weight_kg: x == null ? null : displayToKg(x, unit) })}
      />
      <NumberField
        ariaLabel={`${name} reps`}
        onErrorChange={(m) => reportFieldError(`${key}:reps`, m)}
        value={v.reps}
        integer
        placeholder={plain ? "–" : targetReps != null ? String(targetReps) : String(rx.rep_max ?? "")}
        max={200}
        onCommit={(x) => onChange({ reps: x })}
      />
      {showRir && (
        <NumberField
          ariaLabel={`${name} reps in reserve`}
          onErrorChange={(m) => reportFieldError(`${key}:rir`, m)}
          value={v.rir}
          placeholder="–"
          max={10}
          className="text-[14px]"
          onCommit={(x) => onChange({ rir: x })}
        />
      )}
      <CompleteButton done={done} label={name} onClick={onComplete} />
      {errors.length > 0 && <p aria-hidden className="col-span-full px-1 pb-0.5 text-[12px] leading-snug text-negative">{errors.join(" ")}</p>}
    </div>
  );
}
