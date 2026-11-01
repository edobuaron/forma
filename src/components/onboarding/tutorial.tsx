"use client";
import { Check, CornerDownRight, Download, Dumbbell, Flame, MoreHorizontal, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { finishTutorial } from "@/lib/data/mutations";
import type { TutorialOutcome } from "@/lib/domain/tutorial";
import { PLAN_EXAMPLE, PLAN_TEMPLATE_HREF } from "@/lib/plan-import/template";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
const STEPS = ["Your starter program", "Bring your own plan", "Log your workout"] as const;

/**
 * The three-step first-use tour. Closing it any way other than finishing (Skip, ✕, Esc, tapping outside)
 * counts as skipped. Either outcome is stored on the account, once; replays don't change it.
 */
export function Tutorial({ open, onOpenChange, unit }: { open: boolean; onOpenChange: (open: boolean) => void; unit: "kg" | "lb" }) {
  const [step, setStep] = useState(0);
  const recorded = useRef(false);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  function close(outcome: TutorialOutcome) {
    onOpenChange(false);
    if (recorded.current) return;
    recorded.current = true;
    finishTutorial(createClient(), outcome).catch(() => {
      recorded.current = false;
      toast.error("Couldn't save that you've seen the tour, so it may show again. Replay it any time from Settings.");
    });
  }

  const last = step === STEPS.length - 1;
  return (
    <Sheet open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close("skipped"))}>
      <SheetContent title={STEPS[step]} description={`Step ${step + 1} of ${STEPS.length}`}>
        <ol aria-hidden className="mb-4 flex gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-accent" : "bg-subtle")} />
          ))}
        </ol>

        <div className="min-h-[248px] text-[14.5px] leading-relaxed text-muted-foreground" aria-live="polite">
          {step === 0 && <StarterStep />}
          {step === 1 && <ImportStep onOpenImport={() => close("completed")} />}
          {step === 2 && <LogStep unit={unit} />}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {step === 0 ? (
            <Button variant="quiet" onClick={() => close("skipped")}>Skip tour</Button>
          ) : (
            <Button variant="quiet" onClick={() => setStep(step - 1)}>Back</Button>
          )}
          <div className="flex items-center gap-2">
            {step > 0 && !last && <Button variant="quiet" onClick={() => close("skipped")}>Skip</Button>}
            <Button variant="primary" size="lg" onClick={() => (last ? close("completed") : setStep(step + 1))}>
              {last ? "Start training" : "Next"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StarterStep() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Dumbbell className="size-5" /></span>
        <p className="text-[13.5px]"><span className="font-semibold text-foreground">Starter program</span><br />Push · Pull · Lower · Upper + Skill</p>
      </div>
      <p>
        Your account comes with its own copy of a 4-day starter program. It&apos;s an example, not advice tailored to you,
        and it&apos;s yours to change: rename workouts, swap exercises, edit sets, reps and rest, or delete it.
      </p>
      <p>
        It contains no one else&apos;s logged weights, reps or records. Your history starts with your first workout.
        Find it under <span className="font-medium text-foreground">Programs</span>, where you can also add it again later.
      </p>
    </div>
  );
}

function ImportStep({ onOpenImport }: { onOpenImport: () => void }) {
  return (
    <div className="space-y-3">
      <p>Have a plan from a trainer or a spreadsheet? Paste it, or upload a CSV or Excel (.xlsx) file. A table like this works:</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-[13px] tabular-nums">
          <caption className="sr-only">Example plan</caption>
          <thead className="bg-muted/60 text-foreground">
            <tr>{PLAN_EXAMPLE.header.map((h) => <th key={h} scope="col" className="px-3 py-1.5 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {PLAN_EXAMPLE.rows.map((r) => (
              <tr key={r[0]} className="border-t">{r.map((c, i) => <td key={i} className="px-3 py-1.5">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Include workout/day names for multiple sessions. You&apos;ll review the result and fill in anything missing before saving.</p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild variant="outline" size="md">
          <Link href="/programs/import" onClick={onOpenImport}><Upload /> Open Import</Link>
        </Button>
        <Button asChild variant="quiet" size="md">
          <a href={PLAN_TEMPLATE_HREF} download="forma-plan-template.csv"><Download /> Template (CSV)</a>
        </Button>
      </div>
    </div>
  );
}

function LogStep({ unit }: { unit: "kg" | "lb" }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-3">
      <p>Each set has its weight and reps filled in from your plan or last session. Change them if needed, then tap the tick. Try it:</p>
      <div className="flex items-center gap-2 rounded-lg border bg-card p-2.5" role="group" aria-label="Example set">
        <span className="w-12 text-center text-[13px] font-semibold text-foreground">Set 1</span>
        <span className="flex h-11 flex-1 items-center justify-center rounded-md border border-input text-[15px] font-semibold tabular-nums text-foreground">{unit === "kg" ? "60 kg" : "135 lb"}</span>
        <span className="flex h-11 w-16 items-center justify-center rounded-md border border-input text-[15px] font-semibold tabular-nums text-foreground">10</span>
        <button
          type="button"
          aria-pressed={done}
          aria-label={done ? "Example set done. Mark not done" : "Complete example set"}
          onClick={() => setDone(!done)}
          className={cn("grid h-11 w-12 place-items-center rounded-md transition-colors", focusRing,
            done ? "bg-done text-background" : "border border-input bg-card text-muted-foreground hover:border-done/60 hover:text-done")}
        >
          <Check className="size-5" strokeWidth={done ? 3 : 2.4} />
        </button>
      </div>
      <p className="text-[13px]" aria-live="polite">{done ? "Logged. That's all a set takes, and it saves as you go." : "Nothing is saved here; this is only an example."}</p>
      <ul className="space-y-2 text-[13.5px]">
        <li className="flex gap-2.5"><Flame className="mt-0.5 size-4 shrink-0 text-foreground" /><span><span className="font-medium text-foreground">Warm-up</span> under each exercise adds a warm-up set. It never counts as a working set.</span></li>
        <li className="flex gap-2.5"><CornerDownRight className="mt-0.5 size-4 shrink-0 text-foreground" /><span>Tap a set&apos;s number and choose <span className="font-medium text-foreground">Make it a drop set</span> to log lighter segments after it.</span></li>
        <li className="flex gap-2.5"><MoreHorizontal className="mt-0.5 size-4 shrink-0 text-foreground" /><span>The <span className="font-medium text-foreground">•••</span> button at the top of a workout adds exercises or discards it. Each exercise has its own for notes, previous sessions and RIR.</span></li>
      </ul>
    </div>
  );
}

/** Opens the tour once, on the dashboard, for an account that hasn't seen it. */
export function TutorialOnFirstVisit({ unit }: { unit: "kg" | "lb" }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  return <Tutorial open={open} onOpenChange={setOpen} unit={unit} />;
}

export function ReplayTutorialButton({ unit }: { unit: "kg" | "lb" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Replay tutorial</Button>
      <Tutorial open={open} onOpenChange={setOpen} unit={unit} />
    </>
  );
}
