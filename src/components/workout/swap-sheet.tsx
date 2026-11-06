"use client";
import { ArrowLeft, ArrowRight, Loader2, Repeat, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { matchesExercise } from "@/components/exercises/exercise-search";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CATALOG } from "@/lib/catalog/catalog";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import { performedSets, setPerformed } from "@/lib/domain/sides";
import { equipmentLabel, planSwap, proposeTargets, suggestSubstitutes, type ProposedTargets } from "@/lib/domain/substitution";
import type { ExercisePerformance, WeightUnit } from "@/lib/domain/types";
import { workingSets } from "@/lib/domain/sets";
import { toExerciseConfig, toLoggedSet, type ExerciseRow } from "@/lib/data/types";
import { cn, formatDuration } from "@/lib/utils";
import { formatPerformance } from "./format";
import type { WExercise } from "./types";

export type SwapScope = "today" | "program";

export interface SwapChoice {
  exercise: ExerciseRow;
  scope: SwapScope;
  targets: ProposedTargets;
}

const groupBySlug = new Map(CATALOG.map((c) => [c.slug, c.group as string]));
const muscles = (m: string[]) => m.map((x) => MUSCLE_LABELS[x] ?? x).join(", ");

/**
 * Swap an exercise: search the library (suggestions first, from recorded muscles, equipment and
 * category), then review the replacement's targets and exactly what moves before confirming.
 */
export function SwapSheet({
  open, onOpenChange, item, library, history, loadHistory, unit, program, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: WExercise | null;
  library: ExerciseRow[];
  history: Record<string, ExercisePerformance[]>;
  loadHistory: (exerciseId: string) => Promise<void>;
  unit: WeightUnit;
  /** Whether this exercise comes from a program slot that can be updated, and why not otherwise. */
  program: { available: boolean; reason?: string };
  onConfirm: (c: SwapChoice) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<ExerciseRow | null>(null);
  const [scope, setScope] = useState<SwapScope>("today");
  const [targets, setTargets] = useState<ProposedTargets | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!open) { setQ(""); setPicked(null); setScope("today"); setTargets(null); }
  }, [open]);

  const plan = useMemo(() => (item ? planSwap(item.sets, (s) => setPerformed(toLoggedSet(s))) : null), [item]);
  const suggestions = useMemo(() => {
    if (!item) return [];
    const withGroup = (e: ExerciseRow) => ({ ...e, group: e.catalog_slug ? groupBySlug.get(e.catalog_slug) ?? null : null });
    return suggestSubstitutes(withGroup(item.exercise), library.map(withGroup), { limit: 5 });
  }, [item, library]);
  const list = useMemo(
    () => library.filter((e) => !e.archived_at && e.id !== item?.exercise_id && matchesExercise(e, q)),
    [library, item, q],
  );

  if (!item || !plan) return null;
  const working = item.sets.filter((s) => s.kind === "working").length;
  const loggedWorking = plan.keep.filter((s) => s.kind === "working").length;

  function pick(e: ExerciseRow) {
    setPicked(e);
    setTargets(proposeTargets(item!.prescribed, e, plan!.hasLogged ? plan!.movedWorking : working || null));
    if (!history[e.id]) {
      setLoadingHistory(true);
      void loadHistory(e.id).finally(() => setLoadingHistory(false));
    }
  }

  const title = picked ? `Swap for ${picked.name}` : `Swap ${item.exercise.name}`;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={title} description={picked ? "Review before swapping" : "Pick a replacement from your library"} className="sm:h-[78vh]">
        {!picked ? (
          <>
            <div className="sticky top-0 z-10 -mx-5 bg-card px-5 pb-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search exercises or muscles" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" aria-label="Search exercises" />
              </div>
            </div>
            {!q.trim() && suggestions.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"><Sparkles className="size-3.5" /> Similar in your library</p>
                <div className="divide-y rounded-lg border">
                  {suggestions.map((s) => (
                    <ExerciseRowButton key={s.exercise.id} e={s.exercise} detail={s.reasons.join(" · ")} onClick={() => pick(s.exercise)} />
                  ))}
                </div>
                <p className="mt-1.5 text-[12px] text-muted-foreground">Based on the muscles, equipment and type recorded for each exercise.</p>
              </div>
            )}
            {!q.trim() && <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">All exercises</p>}
            <div className="divide-y">
              {list.map((e) => <ExerciseRowButton key={e.id} e={e} onClick={() => pick(e)} />)}
              {list.length === 0 && <p className="py-8 text-center text-[14px] text-muted-foreground">Nothing in your library matches “{q.trim()}”.</p>}
            </div>
          </>
        ) : (
          <Review
            item={item} picked={picked} scope={scope} setScope={setScope} targets={targets!} setTargets={setTargets}
            program={program} plan={{ ...plan, loggedWorking }} history={history[picked.id]} loadingHistory={loadingHistory} unit={unit}
            onBack={() => setPicked(null)}
            onConfirm={() => { onConfirm({ exercise: picked, scope, targets: targets! }); onOpenChange(false); }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ExerciseRowButton({ e, detail, onClick }: { e: ExerciseRow; detail?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left active:bg-muted">
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{e.name}</span>
        <span className="block text-[12.5px] text-muted-foreground">{muscles(e.primary_muscles)} · {e.equipment}</span>
        {detail && <span className="block text-[12px] text-accent">{detail}</span>}
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Review({ item, picked, scope, setScope, targets, setTargets, program, plan, history, loadingHistory, unit, onBack, onConfirm }: {
  item: WExercise; picked: ExerciseRow; scope: SwapScope; setScope: (s: SwapScope) => void;
  targets: ProposedTargets; setTargets: (t: ProposedTargets) => void; program: { available: boolean; reason?: string };
  plan: { hasLogged: boolean; movedWorking: number; loggedWorking: number }; history: ExercisePerformance[] | undefined;
  loadingHistory: boolean; unit: WeightUnit; onBack: () => void; onConfirm: () => void;
}) {
  const cfg = toExerciseConfig(picked);
  const latest = history?.find((h) => performedSets(h.sets, cfg).length > 0) ?? null;
  const valid = targets.sets >= 1 && targets.rep_min >= 1 && targets.rep_max >= targets.rep_min && targets.rest_s >= 0;
  const field = (k: keyof ProposedTargets, label: string, max: number) => (
    <div className="space-y-1">
      <Label htmlFor={`swap-${k}`}>{label}</Label>
      <Input
        id={`swap-${k}`} inputMode="numeric" pattern="[0-9]*" className="h-11 text-center tabular"
        value={String(targets[k])}
        onChange={(e) => {
          const v = Number(e.target.value.replace(/\D/g, "").slice(0, 4) || 0);
          setTargets({ ...targets, [k]: Math.min(max, v) });
        }}
      />
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[13.5px]">
        <span className="min-w-0 truncate text-muted-foreground">{item.exercise.name}</span>
        <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-semibold">{picked.name}</span>
      </div>

      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">Apply to</p>
        <Segmented<SwapScope>
          value={scope} onChange={(v) => (v === "program" && !program.available ? undefined : setScope(v))} className="w-full [&>button]:flex-1"
          options={[{ value: "today", label: "Today only" }, { value: "program", label: <span className={cn(!program.available && "opacity-50")}>Update program</span> }]}
        />
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          {scope === "today"
            ? "Only this workout changes. Next time the program's exercise comes back."
            : `From the next session, the program uses ${picked.name} in this slot, with the targets below and no planned load. Past workouts are not changed.`}
          {!program.available && program.reason ? ` ${program.reason}` : ""}
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-[13px] font-medium text-muted-foreground">Targets for {picked.name} {plan.hasLogged ? "(remaining sets)" : "today"}</p>
        <div className="grid grid-cols-4 gap-2">
          {field("sets", "Sets", 20)}
          {field("rep_min", "Reps min", 100)}
          {field("rep_max", "Reps max", 100)}
          {field("rest_s", "Rest (s)", 900)}
        </div>
        {!valid && <p className="text-[12.5px] text-negative">Use at least 1 set and a rep range where max is at least min.</p>}
        <p className="text-[12.5px] leading-snug text-muted-foreground">
          Copied from {item.exercise.name} as a starting point: {targets.sets} × {targets.rep_min}–{targets.rep_max}, {formatDuration(targets.rest_s * 1000)} rest.
          No load is carried over: weights on {equipmentLabel(item.exercise.equipment)} and {equipmentLabel(picked.equipment)} aren&apos;t assumed to match.
        </p>
      </div>

      <div className="rounded-lg border px-3 py-2.5 text-[13px]">
        <p className="font-semibold">Last time on {picked.name}</p>
        {loadingHistory && !history ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading…</p>
        ) : latest ? (
          <p className="mt-0.5 text-muted-foreground tabular">{formatPerformance(latest.sets, cfg.loadType, unit, workingSets(latest.sets, cfg))}</p>
        ) : (
          <p className="mt-0.5 text-muted-foreground">No earlier sessions. Suggestions and comparisons for it start from its own history.</p>
        )}
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-[13px] leading-snug">
        <p className="mb-1 flex items-center gap-1.5 font-semibold"><Repeat className="size-3.5" /> What changes</p>
        {plan.hasLogged ? (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>{plan.loggedWorking > 0 ? `${plan.loggedWorking} logged set${plan.loggedWorking === 1 ? "" : "s"}` : "The logged work"} stay{plan.loggedWorking === 1 ? "s" : ""} under {item.exercise.name}, unchanged.</li>
            <li>{picked.name} is added right after it with {targets.sets} new set{targets.sets === 1 ? "" : "s"}, replacing the {plan.movedWorking} not yet done.</li>
            <li>History shows both, linked as a swap. Their records stay separate.</li>
          </ul>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4">
            <li>{item.exercise.name} is replaced by {picked.name} in this workout, with {targets.sets} empty set{targets.sets === 1 ? "" : "s"}.</li>
            <li>History shows it as swapped from {item.exercise.name}.</li>
          </ul>
        )}
        <p className="mt-1 text-muted-foreground">You can undo the swap until you log a set of {picked.name}.</p>
      </div>

      <div className="flex flex-col gap-2 pb-2">
        <Button variant="primary" size="lg" onClick={onConfirm} disabled={!valid}>
          <Repeat /> {scope === "program" ? "Swap and update program" : "Swap for today"}
        </Button>
        <Button variant="ghost" size="lg" onClick={onBack}><ArrowLeft /> Choose another</Button>
      </div>
    </div>
  );
}
