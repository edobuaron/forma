"use client";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useStartWorkout } from "@/components/workout/start-workout";
import { dismissRecommendation } from "@/lib/data/mutations";
import type { StartTemplate } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/client";
import { CategoryBar, CategoryTag } from "@/components/ui/category";
import { workoutCategory } from "@/lib/category";

export function StartButton({ templateId, label = "Start workout", ...rest }: { templateId: string | null; label?: string } & ButtonProps) {
  const { start, busy } = useStartWorkout();
  return (
    <Button variant="primary" {...rest} disabled={!!busy} onClick={() => start(templateId)}>
      {busy ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} {label}
    </Button>
  );
}

function lastDoneLabel(t: StartTemplate) {
  return t.lastDone ? `Last done ${formatDistanceToNowStrict(new Date(t.lastDone), { addSuffix: true })}` : "Not done yet";
}

/** The dashboard's main moment: the next workout (rotation or suggestion, labelled as such) and one large start action. */
export function NextWorkout({ template, basis, order }: { template: StartTemplate; basis: "rotation" | "suggested"; order: string[] }) {
  const { start, busy } = useStartWorkout();
  const cat = workoutCategory(template.name);
  const preview = template.exercises.slice(0, 4);
  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[13px] font-semibold text-accent">{basis === "rotation" ? "Next in your rotation" : "Suggested next"}</span>
          <CategoryTag category={cat} />
        </div>
        <h2 className="mt-1.5 text-[36px] font-bold leading-[1.05] tracking-[-0.035em] md:text-[44px]">{template.name}</h2>
        <p className="mt-2 text-[14px] text-muted-foreground tabular">
          <span className="font-semibold text-foreground">{template.exerciseCount}</span> exercises
          <span aria-hidden className="mx-1.5 text-border">|</span>
          <span className="font-semibold text-foreground">{template.setCount}</span> sets
          <span aria-hidden className="mx-1.5 text-border">|</span>
          {lastDoneLabel(template)}
        </p>
        <p className="mt-1.5 max-w-xl text-[12.5px] leading-snug text-muted-foreground">
          {basis === "rotation"
            ? `Your recent workouts follow your program order (${order.join(", ")}), so this one comes next.`
            : "The workout you've gone longest without. Pick any other below if you'd rather."}
        </p>
        {preview.length > 0 && (
          <p className="mt-2 line-clamp-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            {preview.join(", ")}{template.exercises.length > preview.length ? ` and ${template.exercises.length - preview.length} more` : ""}
          </p>
        )}
      </div>
      <Button variant="primary" size="xl" className="w-full shrink-0 md:w-auto md:min-w-52" disabled={!!busy} onClick={() => start(template.id)}>
        {busy === template.id ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} Start {template.name}
      </Button>
    </div>
  );
}

/** Every other workout, one tap to start. Shows when each was last done, without prescribing an order. */
export function TemplateGrid({ templates }: { templates: StartTemplate[] }) {
  const { start, busy } = useStartWorkout();
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {templates.map((t) => {
        const cat = workoutCategory(t.name);
        return (
          <button
            key={t.id}
            disabled={!!busy}
            onClick={() => start(t.id)}
            aria-label={`Start ${t.name}`}
            className="group flex min-h-[64px] items-stretch gap-3 rounded-md border bg-background/60 p-3 text-left transition-[background-color,border-color,transform] hover:border-accent/40 hover:bg-muted active:scale-[0.985] dark:bg-muted/40"
          >
            <CategoryBar category={cat} />
            <span className="flex min-w-0 flex-1 flex-col justify-center">
              <span className="truncate text-[15px] font-semibold tracking-tight">{t.name}</span>
              <span className="mt-0.5 truncate text-[12.5px] text-muted-foreground tabular">{t.setCount} sets · {t.lastDone ? formatDistanceToNowStrict(new Date(t.lastDone), { addSuffix: true }) : "not done yet"}</span>
            </span>
            <span className="grid size-8 shrink-0 place-items-center self-center rounded-full bg-accent-soft text-accent transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              {busy === t.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-current" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function DismissButton({ ruleKey, evidence }: { ruleKey: string; evidence: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      aria-label="Dismiss"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try { await dismissRecommendation(createClient(), ruleKey, evidence); router.refresh(); } finally { setBusy(false); }
      }}
      className="-m-1.5 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <X className="size-4" />
    </button>
  );
}
