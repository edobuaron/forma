"use client";
import { ChevronRight, Download, LogOut, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { displayToKg, kgToDisplay } from "@/lib/domain/units";
import { AccountSettings } from "./account-settings";
import { MuscleChips } from "@/components/exercises/muscle-chips";
import { useShowRir } from "@/components/workout/rir-visibility";
import { updateProfile } from "@/lib/data/mutations";
import { maintenanceMuscles, type ProfileRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2.5 px-1 text-[15px] font-semibold tracking-tight">{title}</h2>
      <div className="divide-y overflow-hidden rounded-lg border bg-card shadow-card">{children}</div>
    </section>
  );
}
function Row({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0"><p className="text-[15px] font-medium">{label}</p>{sub && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{sub}</p>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsForm({ profile, email }: { profile: ProfileRow; email?: string }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [p, setP] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [showRir, setShowRir] = useShowRir();
  useEffect(() => setMounted(true), []);

  async function save(patch: Partial<ProfileRow>) {
    if (saving) return;
    setSaving(true);
    const prev = p;
    setP({ ...p, ...patch });
    try {
      await updateProfile(createClient(), profile.id, patch);
      router.refresh();
    } catch (e) {
      setP(prev);
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-7">
      <AccountSettings email={email} />
      <fieldset disabled={saving} className="min-w-0 space-y-7">
      <Section title="Appearance">
        <Row label="Theme" sub="System follows your device setting">
          {mounted && (
            <Segmented value={(theme as "light" | "dark" | "system") ?? "system"} onChange={setTheme} options={[
              { value: "light", label: <span aria-label="Light theme"><Sun aria-hidden className="size-4" /><span className="sr-only">Light</span></span> }, { value: "dark", label: <span aria-label="Dark theme"><Moon aria-hidden className="size-4" /><span className="sr-only">Dark</span></span> }, { value: "system", label: <span aria-label="System theme"><Monitor aria-hidden className="size-4" /><span className="sr-only">System</span></span> },
            ]} />
          )}
        </Row>
      </Section>

      <Section title="Profile">
        <Row label="Display name">
          <Input aria-label="Display name" maxLength={120} defaultValue={p.display_name ?? ""} className="h-9 w-40 text-right" onBlur={(e) => e.target.value !== (p.display_name ?? "") && save({ display_name: e.target.value || null })} />
        </Row>
        <Row label="Bodyweight" sub="Recorded with each workout for bodyweight exercises">
          <div className="flex items-center gap-2">
            <Input aria-label="Bodyweight" key={`${p.unit}:${p.bodyweight_kg}`} inputMode="decimal" defaultValue={p.bodyweight_kg != null ? kgToDisplay(Number(p.bodyweight_kg), p.unit) : ""} className="h-9 w-20 text-right"
              onBlur={(e) => { const v = e.target.value.trim(); const n = Number(v.replace(",", ".")); if (v === "") save({ bodyweight_kg: null }); else if (Number.isFinite(n) && displayToKg(n, p.unit) >= 20 && displayToKg(n, p.unit) <= 400) save({ bodyweight_kg: displayToKg(n, p.unit) }); else toast.error("Enter a valid bodyweight"); }} />
            <span className="text-[13px] text-muted-foreground">{p.unit}</span>
          </div>
        </Row>
      </Section>

      <Section title="Training">
        <Row label="Show RIR inputs" sub="Reps in reserve; hiding inputs keeps logged values. Saved on this device."><Switch aria-label="Show RIR inputs" checked={showRir} onCheckedChange={setShowRir} /></Row>
        <Row label="Weight unit" sub="Data is stored in kg; display converts">
          <Segmented value={p.unit} onChange={(u) => save({ unit: u })} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
        </Row>
        <Row label="Default rest" sub="Used when an exercise has no rest set">
          <div className="flex items-center gap-2">
            <Input aria-label="Default rest in seconds" inputMode="numeric" defaultValue={p.default_rest_s} className="h-9 w-20 text-right"
              onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= 1800) save({ default_rest_s: n }); else toast.error("0–1800 seconds"); }} />
            <span className="text-[13px] text-muted-foreground">sec</span>
          </div>
        </Row>
        <Row label="Start rest timer automatically" sub="After completing a working set">
          <Switch aria-label="Start rest timer automatically" checked={p.auto_rest_timer} onCheckedChange={(c) => save({ auto_rest_timer: c })} />
        </Row>
        <Row label="Rest timer sound" sub="Plays when rest ends (app must be open)">
          <Switch aria-label="Rest timer sound" checked={p.rest_sound} onCheckedChange={(c) => save({ rest_sound: c })} />
        </Row>
        <Row label="Conservative progression" sub="Require a rep in reserve before suggesting more load">
          <Switch aria-label="Conservative progression" checked={p.progression_conservative} onCheckedChange={(c) => save({ progression_conservative: c })} />
        </Row>
        <div className="px-4 py-3">
          <p className="text-[15px] font-medium">Maintenance muscles</p>
          <p className="mb-3 mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
            Optional. Muscles you&apos;re keeping at maintenance volume are marked in Progress, and volume insights for them say when you&apos;re above that level. Load progression isn&apos;t affected.
          </p>
          <MuscleChips value={maintenanceMuscles(p)} onChange={(v) => save({ maintenance_muscles: v })} />
        </div>
        <Link href="/exercises" className="flex min-h-14 items-center justify-between px-4 transition-colors hover:bg-muted/60">
          <span><span className="block text-[15px] font-medium">Equipment increments & exercise names</span><span className="block text-[12.5px] text-muted-foreground">Edit per exercise in the library</span></span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
        <Link href="/programs" className="flex min-h-14 items-center justify-between px-4 transition-colors hover:bg-muted/60">
          <span><span className="block text-[15px] font-medium">Workout program</span><span className="block text-[12.5px] text-muted-foreground">Edit workouts, exercises and prescriptions</span></span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </Section>

      <Section title="Your data">
        <Row label="Full backup" sub="Download your data as JSON. In-app restore is not yet available.">
          <Button asChild variant="outline" size="sm"><a href="/api/export?format=json"><Download /> JSON</a></Button>
        </Row>
        <Row label="Set log" sub="One row per set, for spreadsheets">
          <Button asChild variant="outline" size="sm"><a href="/api/export?format=csv&type=sets"><Download /> CSV</a></Button>
        </Row>
        <Row label="Body measurements">
          <Button asChild variant="outline" size="sm"><a href="/api/export?format=csv&type=body"><Download /> CSV</a></Button>
        </Row>
      </Section>

      </fieldset>
      <form action="/auth/signout" method="post">
        <Button type="submit" variant="ghost" className="w-full text-muted-foreground"><LogOut /> Sign out this device</Button>
      </form>
    </div>
  );
}
