"use client";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { startWorkout } from "@/lib/data/mutations";
import { createClient } from "@/lib/supabase/client";
import { cn, DAY_NAMES } from "@/lib/utils";

export interface StartTemplate {
  id: string;
  name: string;
  dayOfWeek: number | null;
  exerciseCount: number;
  setCount: number;
  exercises: string[];
  lastDone: string | null;
}

export function useStartWorkout() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function start(templateId: string | null) {
    setBusy(templateId ?? "empty");
    try {
      const id = await startWorkout(createClient(), templateId);
      router.push(`/workout/${id}`);
    } catch (e) {
      const err = e as Error & { code?: string; sessionId?: string };
      if (err.code === "in_progress" && err.sessionId) {
        toast("You already have a workout in progress.");
        router.push(`/workout/${err.sessionId}`);
      } else {
        toast.error(err.message);
      }
      setBusy(null);
    }
  }
  return { start, busy };
}

export function StartWorkout({ templates }: { templates: StartTemplate[] }) {
  const { start, busy } = useStartWorkout();
  const today = new Date().getDay();
  const sorted = [...templates].sort((a, b) => {
    const da = a.dayOfWeek == null ? 99 : (a.dayOfWeek - today + 7) % 7;
    const db = b.dayOfWeek == null ? 99 : (b.dayOfWeek - today + 7) % 7;
    return da - db;
  });

  return (
    <div className="space-y-3">
      {sorted.map((t, i) => {
        const isToday = t.dayOfWeek === today;
        return (
          <button
            key={t.id}
            disabled={!!busy}
            onClick={() => start(t.id)}
            className={cn(
              "group flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left shadow-card transition-colors hover:bg-muted/60 active:bg-muted md:p-5",
              isToday && "border-accent/40 ring-1 ring-accent/20",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[17px] font-semibold tracking-tight">{t.name}</span>
                {isToday ? <Badge tone="accent">Today</Badge> : i === 0 && t.dayOfWeek != null ? <Badge>Next</Badge> : null}
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t.dayOfWeek != null ? DAY_NAMES[t.dayOfWeek] : "Unscheduled"} · {t.exerciseCount} exercises · {t.setCount} sets
                {t.lastDone && ` · last ${formatDistanceToNowStrict(new Date(t.lastDone), { addSuffix: true })}`}
              </p>
              <p className="mt-2 line-clamp-1 text-[13px] text-muted-foreground/80">{t.exercises.join(" · ")}</p>
            </div>
            {busy === t.id ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <ArrowRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
          </button>
        );
      })}
      <Button variant="outline" size="lg" className="w-full" disabled={!!busy} onClick={() => start(null)}>
        {busy === "empty" ? <Loader2 className="animate-spin" /> : <Plus />} Empty workout
      </Button>
    </div>
  );
}
