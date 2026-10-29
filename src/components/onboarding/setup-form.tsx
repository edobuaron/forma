"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { completeOnboarding } from "@/lib/data/mutations";
import { createClient } from "@/lib/supabase/client";

export function SetupForm({ initialName, initialUnit, hasStarter }: { initialName: string; initialUnit: "kg" | "lb"; hasStarter: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState<"kg" | "lb">(initialUnit);
  const [busy, setBusy] = useState<null | "continue" | "skip">(null);

  async function finish(mode: "continue" | "skip") {
    setBusy(mode);
    try {
      // Safe to retry: setup only records name and units.
      await completeOnboarding(createClient(), mode === "skip" ? {} : { displayName: name.trim() || null, unit });
      router.replace("/");
      router.refresh();
    } catch (e) {
      toast.error(`Setup didn't finish: ${(e as Error).message}. You can try again.`);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Welcome to Forma</h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">Two quick, optional questions. You can change both later in Settings.</p>
      </div>

      <div className="space-y-4">
        <Field label="What should we call you? (optional)">
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="given-name" />
        </Field>
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-muted-foreground">Weights in</p>
          <Segmented value={unit} onChange={setUnit} options={[{ value: "kg", label: "Kilograms (kg)" }, { value: "lb", label: "Pounds (lb)" }]} />
        </div>
      </div>

      {hasStarter && (
        <div className="rounded-lg border p-4 text-[13.5px] leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Your starter program is ready</p>
          <p className="mt-1">
            We&apos;ve added your own copy of a generic 4-day program (Push, Pull, Lower, Upper + Skill). It&apos;s an example,
            not advice tailored to you, and no weights are preset. Edit it, create other programs, or archive it under Programs.
          </p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" disabled={busy != null} onClick={() => finish("skip")}>
          {busy === "skip" && <Loader2 className="animate-spin" />} Skip
        </Button>
        <Button variant="primary" size="lg" disabled={busy != null} onClick={() => finish("continue")}>
          {busy === "continue" && <Loader2 className="animate-spin" />} Continue
        </Button>
      </div>
      <p className="text-[12.5px] text-muted-foreground">Body measurements aren&apos;t needed. Add them under Body whenever you like.</p>
    </div>
  );
}
