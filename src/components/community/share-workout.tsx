"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { postOutcome, previewShare, shareWorkout, type Audience, type ShareInclude, type WorkoutSnapshot } from "@/lib/data/posts";
import type { DistanceUnit } from "@/lib/domain/running";
import type { Gym } from "@/lib/domain/social";
import type { WeightUnit } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { SnapshotView } from "./post-card";

export function ShareWorkout({ sessionId, gym, unit, distUnit, sharedTo }: { sessionId: string; gym: Gym | null; unit: WeightUnit; distUnit: DistanceUnit; sharedTo: Audience[] }) {
  const router = useRouter();
  const [audience, setAudience] = useState<Audience | null>(null);
  const [include, setInclude] = useState<ShareInclude>({ loads: true, reps: true, duration: true, runs: true });
  const [caption, setCaption] = useState("");
  const [snap, setSnap] = useState<WorkoutSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [id] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let live = true;
    previewShare(createClient(), sessionId, include).then((s) => { if (live) setSnap(s); }).catch((e) => toast.error((e as Error).message));
    return () => { live = false; };
  }, [sessionId, include]);

  const options: { value: Audience; label: string; sub: string; disabled?: string }[] = [
    { value: "friends", label: "Friends", sub: "Only people you've accepted as friends." },
    { value: "gym", label: "Gym community", sub: gym ? `Everyone who chose ${gym.name} as their gym, including people who aren't your friends.` : "Choose your gym first.", disabled: gym ? undefined : "no gym" },
  ];
  const toggles: { key: keyof ShareInclude; label: string }[] = [
    { key: "loads", label: "Weights" }, { key: "reps", label: "Reps" }, { key: "duration", label: "Duration" }, { key: "runs", label: "Runs (distance and time)" },
  ];

  async function post() {
    if (!audience) return;
    setBusy(true);
    try {
      const r = await shareWorkout(createClient(), { id, sessionId, audience, include, caption: caption.trim() });
      if (r === "shared") { toast.success(audience === "gym" ? "Shared with your gym community" : "Shared with friends"); router.push(audience === "gym" ? "/community?tab=gym" : "/community/me"); router.refresh(); }
      else toast.error(postOutcome(r));
    } catch { toast.error("Not posted. Check your connection and try again."); } finally { setBusy(false); }
  }

  return (
    <div className="grid max-w-4xl gap-6 md:grid-cols-[1fr_1fr]">
      <div className="space-y-6">
        <fieldset>
          <legend className="mb-2 text-[15px] font-semibold">Who can see it</legend>
          <div className="space-y-2">
            {options.map((o) => {
              const done = sharedTo.includes(o.value);
              return (
                <label key={o.value} className={cn("flex min-h-14 cursor-pointer items-start gap-3 rounded-md border bg-card p-3", audience === o.value && "border-accent bg-accent-soft", (o.disabled || done) && "cursor-not-allowed opacity-55")}>
                  <input type="radio" name="audience" className="mt-1 size-4 accent-[var(--accent)]" disabled={!!o.disabled || done} checked={audience === o.value} onChange={() => setAudience(o.value)} />
                  <span><span className="block text-[14.5px] font-semibold">{o.label}{done ? " · already shared" : ""}</span><span className="block text-[12.5px] text-muted-foreground">{o.sub}</span></span>
                </label>
              );
            })}
          </div>
          {!gym && <p className="mt-2 text-[12.5px] text-muted-foreground"><Link href="/community/gym" className="font-semibold underline-offset-2 hover:underline">Choose your gym</Link> to share with a gym community.</p>}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[15px] font-semibold">What to include</legend>
          <div className="divide-y rounded-md border bg-card">
            {toggles.map((t) => (
              <label key={t.key} className="flex min-h-12 items-center justify-between gap-3 px-3">
                <span className="text-[14px]">{t.label}</span>
                <Switch checked={include[t.key]} onCheckedChange={(v) => setInclude({ ...include, [t.key]: v })} aria-label={t.label} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">Never included: notes, bodyweight, body measurements, starting energy and reasons for a shortened workout. Only completed working sets are shown.</p>
        </fieldset>

        <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={500} rows={3} placeholder="Add a caption (optional)" aria-label="Caption" />
      </div>

      <div>
        <p className="mb-2 text-[15px] font-semibold">Preview</p>
        <div className="rounded-lg border bg-card p-4 shadow-card">
          {snap ? <SnapshotView snap={snap} unit={unit} distUnit={distUnit} /> : <p className="text-[13px] text-muted-foreground">Loading…</p>}
          {caption.trim() && <p className="mt-2.5 whitespace-pre-wrap text-[14px]">{caption.trim()}</p>}
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">This is exactly what will be posted. Later edits to the workout won&apos;t change it. Deleting the workout deletes the post.</p>
        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!audience || !snap || busy} onClick={post}>
          {busy ? "Posting…" : audience === "gym" ? "Share with gym community" : audience === "friends" ? "Share with friends" : "Choose who can see it"}
        </Button>
      </div>
    </div>
  );
}
