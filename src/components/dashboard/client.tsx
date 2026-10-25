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

export function StartButton({ templateId, label = "Start workout", ...rest }: { templateId: string | null; label?: string } & ButtonProps) {
  const { start, busy } = useStartWorkout();
  return (
    <Button variant="primary" {...rest} disabled={!!busy} onClick={() => start(templateId)}>
      {busy ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} {label}
    </Button>
  );
}

/** One tap starts any workout today. Shows when each was last done, without prescribing an order. */
export function TemplateGrid({ templates }: { templates: StartTemplate[] }) {
  const { start, busy } = useStartWorkout();
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
      {templates.map((t) => (
        <button
          key={t.id}
          disabled={!!busy}
          onClick={() => start(t.id)}
          className="flex min-h-[88px] flex-col justify-between rounded-lg border bg-background p-3.5 text-left transition-colors hover:bg-muted/60 active:bg-muted md:p-4"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="text-[16px] font-semibold leading-tight tracking-tight">{t.name}</span>
            {busy === t.id ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Play className="size-3.5 shrink-0 fill-current text-accent" />}
          </span>
          <span className="mt-2 text-[12.5px] leading-snug text-muted-foreground">
            {t.setCount} sets · {t.lastDone ? formatDistanceToNowStrict(new Date(t.lastDone), { addSuffix: true }) : "not done yet"}
          </span>
        </button>
      ))}
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
      className="-m-1 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <X className="size-4" />
    </button>
  );
}
