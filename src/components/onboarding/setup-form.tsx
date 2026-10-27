"use client";
import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { completeOnboarding } from "@/lib/data/mutations";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Choice = "empty" | "starter";

const STARTER_DAYS = [
  { name: "Push", items: "Incline Smith press, shoulder press, lateral raise, pec deck, triceps" },
  { name: "Pull", items: "Weighted pull-up, barbell row, pulldown, rear delts, curls" },
  { name: "Lower", items: "Leg press, leg curl, leg extension, lumbar extension, calves, abs" },
  { name: "Upper + Skill", items: "High pull-ups, assisted muscle-up transitions, dips, press, rows" },
];

export function SetupForm({ initialName, initialUnit }: { initialName: string; initialUnit: "kg" | "lb" }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState<"kg" | "lb">(initialUnit);
  const [choice, setChoice] = useState<Choice>("empty");
  const [busy, setBusy] = useState<null | "continue" | "skip">(null);

  async function finish(mode: "continue" | "skip") {
    setBusy(mode);
    try {
      // Safe to retry: the server creates nothing once setup is recorded.
      await completeOnboarding(createClient(), mode === "skip" ? "empty" : choice,
        mode === "skip" ? {} : { displayName: name.trim() || null, unit });
      router.replace("/");
      router.refresh();
    } catch (e) {
      toast.error(`Setup didn't finish: ${(e as Error).message}. Nothing was created twice, so you can try again.`);
      setBusy(null);
    }
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Welcome to Forma</h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">Two quick choices. You can change all of this later, or skip it.</p>
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

      <fieldset className="space-y-3">
        <legend className="mb-3 text-[13px] font-medium text-muted-foreground">How do you want to start?</legend>
        <ChoiceCard selected={choice === "empty"} onSelect={() => setChoice("empty")} title="Start with an empty program">
          Add your own workouts and pick exercises from the library of 100+ exercises, or create your own.
        </ChoiceCard>
        <ChoiceCard selected={choice === "starter"} onSelect={() => setChoice("starter")} title="Use the example 4-day template" badge="Optional">
          A generic split to edit or delete. It&apos;s an example, not advice tailored to you. No weights are preset: you choose
          your own on the first session.
          <span className="mt-2 block space-y-0.5 text-[12.5px]">
            {STARTER_DAYS.map((d) => <span key={d.name} className="block"><span className="font-medium text-foreground">{d.name}:</span> {d.items}</span>)}
          </span>
        </ChoiceCard>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" disabled={busy != null} onClick={() => finish("skip")}>
          {busy === "skip" && <Loader2 className="animate-spin" />} Skip, start empty
        </Button>
        <Button variant="primary" size="lg" disabled={busy != null} onClick={() => finish("continue")}>
          {busy === "continue" && <Loader2 className="animate-spin" />} Continue
        </Button>
      </div>
      <p className="text-[12.5px] text-muted-foreground">Body measurements aren&apos;t needed. Add them under Body whenever you like.</p>
    </div>
  );
}

function ChoiceCard({ selected, onSelect, title, badge, children }: { selected: boolean; onSelect: () => void; title: string; badge?: string; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect}
      className={cn("flex w-full gap-3 rounded-lg border p-4 text-left transition-colors", selected ? "border-accent bg-accent-soft/50" : "hover:bg-muted/60")}>
      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border", selected && "border-accent bg-accent text-accent-foreground")}>
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[15px] font-medium">
          {title}
          {badge && <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{badge}</span>}
        </span>
        <span className="mt-1 block text-[13.5px] leading-relaxed text-muted-foreground">{children}</span>
      </span>
    </button>
  );
}
