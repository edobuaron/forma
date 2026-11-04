"use client";
import { ArrowLeft, MapPin, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { addGym, gymsInCity, leaveGym, searchGyms, setDiscoverable, setMyGym, type Membership } from "@/lib/data/social";
import { gymBadge, gymLocation, likelyDuplicates, validateGym, type Gym, type GymDraft } from "@/lib/domain/social";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "./common";

const EMPTY: GymDraft = { name: "", chain: "", address: "", city: "", country: "IT" };

export function GymSettings({ gym, membership }: { gym: Gym | null; membership: Membership | null }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Gym[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<GymDraft>(EMPTY);
  const [dupes, setDupes] = useState<Gym[]>([]);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(!gym);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setResults(null); return; }
      try { setResults(await searchGyms(createClient(), q)); } catch (e) { toast.error((e as Error).message); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function choose(g: Gym) {
    if (gym && membership?.discoverable && gym.id !== g.id && !confirm("Switching gym turns discovery off. You can turn it on again for the new gym.")) return;
    setBusy(true);
    try { await setMyGym(createClient(), g.id); toast.success(`Your gym: ${g.name}`); router.push("/community"); router.refresh(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function checkAndAdd() {
    const err = validateGym(draft);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      if (dupes.length === 0) {
        const near = likelyDuplicates(draft, await gymsInCity(createClient(), draft.city));
        if (near.length > 0) { setDupes(near); setBusy(false); return; }
      }
      const r = await addGym(createClient(), { ...draft, country: draft.country.toUpperCase() });
      await setMyGym(createClient(), r.id);
      toast.success(r.created ? "Gym added" : "That gym already existed, so we used it");
      router.push("/community"); router.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/community" className="inline-flex h-10 items-center gap-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Community</Link>

      {gym && (
        <Panel className="p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><MapPin className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold">{gym.name}</p>
              <p className="text-[13px] text-muted-foreground">{gymLocation(gym)}</p>
              <Badge className="mt-2" tone={gym.verified ? "positive" : "outline"}>{gymBadge(gym)}</Badge>
            </div>
          </div>
          {!gym.verified && <p className="mt-3 text-[12.5px] text-muted-foreground">Communities are created by members and aren&apos;t run by or affiliated with the gym.</p>}

          <div className="mt-4 border-t pt-4">
            <div className="flex items-start justify-between gap-4">
              <label htmlFor="discover" className="min-w-0">
                <span className="block text-[15px] font-semibold">Let people at this gym discover me</span>
                <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">
                  When on, other members of this branch can see your display name and initials and send you a friend request. They never see your email, workouts, when you train or where you are. Off by default; switching gym turns it off.
                </span>
              </label>
              <Switch id="discover" checked={!!membership?.discoverable} disabled={busy}
                onCheckedChange={async (on) => {
                  setBusy(true);
                  try { await setDiscoverable(createClient(), on); toast.success(on ? "People at this gym can now find you" : "You're no longer discoverable"); router.refresh(); }
                  catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
                }} />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setChanging(true)}>Change gym</Button>
            <Button variant="danger" disabled={busy} onClick={async () => {
              if (!confirm("Leave this gym? You'll stop being discoverable there. Friends stay friends.")) return;
              setBusy(true);
              try { await leaveGym(createClient()); toast.success("You left the gym"); router.push("/community"); router.refresh(); }
              catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
            }}>Leave gym</Button>
          </div>
        </Panel>
      )}

      {changing && !adding && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold">{gym ? "Choose a different gym" : "Find your gym"}</h2>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gym name, street or city" className="pl-9" aria-label="Search gyms" autoFocus={!gym} />
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">Each branch is its own community, so pick the exact location.</p>
          {results && (
            <Panel className="mt-3 divide-y">
              {results.length === 0 && <p className="px-4 py-4 text-[14px] text-muted-foreground">No gyms match &ldquo;{q.trim()}&rdquo;.</p>}
              {results.map((g) => (
                <button key={g.id} disabled={busy || g.id === gym?.id} onClick={() => choose(g)} className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60 disabled:opacity-60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{g.name}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">{gymLocation(g)}</span>
                  </span>
                  {g.id === gym?.id ? <Badge>Current</Badge> : <Badge tone={g.verified ? "positive" : "outline"}>{g.verified ? "Verified" : "Unofficial"}</Badge>}
                </button>
              ))}
            </Panel>
          )}
          <Button variant="quiet" className="mt-3" onClick={() => { setAdding(true); setDraft({ ...EMPTY, name: q.trim() }); setDupes([]); }}><Plus /> My gym isn&apos;t listed</Button>
        </section>
      )}

      {adding && (
        <section>
          <h2 className="mb-1 text-[15px] font-semibold">Add a gym</h2>
          <p className="mb-3 text-[13px] text-muted-foreground">It will appear as an unofficial community. Add the specific branch, not the chain.</p>
          <div className="space-y-3">
            <Field label="Gym and branch name"><Input value={draft.name} maxLength={80} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDupes([]); }} placeholder="e.g. FitLab Navigli" /></Field>
            <Field label="Chain (optional)"><Input value={draft.chain} maxLength={60} onChange={(e) => setDraft({ ...draft, chain: e.target.value })} placeholder="e.g. FitLab" /></Field>
            <Field label="Street address"><Input value={draft.address} maxLength={160} onChange={(e) => { setDraft({ ...draft, address: e.target.value }); setDupes([]); }} /></Field>
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <Field label="City"><Input value={draft.city} maxLength={80} onChange={(e) => { setDraft({ ...draft, city: e.target.value }); setDupes([]); }} /></Field>
              <Field label="Country"><Input value={draft.country} maxLength={2} onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })} aria-label="Country code" /></Field>
            </div>
          </div>
          {dupes.length > 0 && (
            <div className="mt-4 rounded-lg border border-pending/40 bg-muted/50 p-3">
              <p className="text-[14px] font-semibold">Is it one of these?</p>
              <div className="mt-2 space-y-2">
                {dupes.map((g) => (
                  <button key={g.id} onClick={() => choose(g)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border bg-card px-3 text-left hover:border-accent/50">
                    <span className="min-w-0"><span className="block truncate text-[14px] font-semibold">{g.name}</span><span className="block truncate text-[12.5px] text-muted-foreground">{gymLocation(g)}</span></span>
                    <span className="text-[13px] font-semibold text-accent">Use this</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12.5px] text-muted-foreground">If none of these is your branch, add it anyway.</p>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="primary" disabled={busy} onClick={checkAndAdd}>{dupes.length > 0 ? "Add anyway" : "Add gym"}</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Back to search</Button>
          </div>
        </section>
      )}

      {!gym && !adding && (
        <p className="text-[13px] text-muted-foreground">Prefer not to? <Link href="/community" className="font-semibold text-foreground underline-offset-2 hover:underline">Skip for now</Link>. You can still add friends with an invite link.</p>
      )}
    </div>
  );
}
