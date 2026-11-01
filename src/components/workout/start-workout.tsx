"use client";
import { formatDistanceToNowStrict, isToday } from "date-fns";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setEnergyRating, startWorkout } from "@/lib/data/mutations";
import type { StartTemplate } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { EnergySheet } from "./energy-rating";

/** A past day is logged at the current time of day on that date; today starts a live workout. */
function startTimeFor(day?: Date): Date | undefined {
  if (!day || isToday(day)) return undefined;
  const now = new Date();
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), now.getMinutes());
}

/**
 * Starting a workout today first offers the optional energy question; Skip starts without a
 * rating. A past day starts straight away (its energy can be added later in History).
 * Render `energyPrompt` wherever `start` is used.
 */
export function useStartWorkout() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ templateId: string | null } | null>(null);

  async function begin(templateId: string | null, day: Date | undefined, energy: number | null) {
    setBusy(templateId ?? "empty");
    const db = createClient();
    try {
      const id = await startWorkout(db, templateId, { startedAt: startTimeFor(day) });
      if (energy != null) {
        try {
          await setEnergyRating(db, id, energy);
        } catch {
          toast.error("Workout started, but your energy rating wasn't saved. You can add it from the workout options.");
        }
      }
      router.push(`/workout/${id}`);
    } catch (e) {
      const err = e as Error & { code?: string; sessionId?: string };
      setAsking(null);
      if (err.code === "in_progress" && err.sessionId) {
        toast("Finish or discard the workout in progress first.");
        router.push(`/workout/${err.sessionId}`);
      } else {
        toast.error(err.message);
      }
      setBusy(null);
    }
  }

  function start(templateId: string | null, day?: Date) {
    if (startTimeFor(day)) void begin(templateId, day, null);
    else setAsking({ templateId });
  }

  const energyPrompt = (
    <EnergySheet
      open={asking != null}
      onOpenChange={(o) => !o && setAsking(null)}
      mode="start"
      initial={null}
      busy={busy != null}
      onSubmit={(v) => asking && void begin(asking.templateId, undefined, v)}
    />
  );
  return { start, busy, energyPrompt };
}

/** Every workout in the program, in program order. Nothing is tied to a weekday. */
export function StartWorkout({ templates, day, compact = false }: { templates: StartTemplate[]; day?: Date; compact?: boolean }) {
  const { start, busy, energyPrompt } = useStartWorkout();

  return (
    <div className={cn(compact ? "space-y-2" : "space-y-3")}>
      {energyPrompt}
      {templates.map((t) => (
        <button
          key={t.id}
          disabled={!!busy}
          onClick={() => start(t.id, day)}
          className={cn(
            "group flex w-full items-center gap-4 rounded-lg border bg-card text-left transition-colors hover:bg-muted/60 active:bg-muted",
            compact ? "px-4 py-3" : "p-4 shadow-card md:p-5",
          )}
        >
          <div className="min-w-0 flex-1">
            <span className={cn("font-semibold tracking-tight", compact ? "text-[15.5px]" : "text-[17px]")}>{t.name}</span>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {t.exerciseCount} exercises · {t.setCount} sets
              {t.lastDone ? ` · last ${formatDistanceToNowStrict(new Date(t.lastDone), { addSuffix: true })}` : " · not done yet"}
            </p>
            {!compact && <p className="mt-2 line-clamp-1 text-[13px] text-muted-foreground/80">{t.exercises.join(" · ")}</p>}
          </div>
          {busy === t.id ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
        </button>
      ))}
      <Button variant="outline" size={compact ? "md" : "lg"} className="w-full" disabled={!!busy} onClick={() => start(null, day)}>
        {busy === "empty" ? <Loader2 className="animate-spin" /> : <Plus />} Empty workout
      </Button>
    </div>
  );
}
