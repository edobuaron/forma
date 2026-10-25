"use client";
import { Loader2, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useStartWorkout } from "@/components/workout/start-workout";
import { dismissRecommendation } from "@/lib/data/mutations";
import { createClient } from "@/lib/supabase/client";

export function StartButton({ templateId, label = "Start workout", ...rest }: { templateId: string | null; label?: string } & ButtonProps) {
  const { start, busy } = useStartWorkout();
  return (
    <Button variant="primary" {...rest} disabled={!!busy} onClick={() => start(templateId)}>
      {busy ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />} {label}
    </Button>
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
