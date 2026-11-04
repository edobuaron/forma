"use client";
import { CalendarClock, Dumbbell, MapPin, Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, SectionTitle } from "@/components/ui/misc";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { postBuddy, postOutcome, type FeedPost } from "@/lib/data/posts";
import type { GymCounts } from "@/lib/data/social";
import type { DistanceUnit } from "@/lib/domain/running";
import { browserZone, formatInZone, isValidZone, wallParts, zonedToUtc } from "@/lib/domain/schedule";
import { gymBadge, gymLocation, type Gym } from "@/lib/domain/social";
import type { WeightUnit } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/client";
import { FeedList, PostCard } from "./post-card";

export function ClubScreen({ gym, discoverable, counts, activity, posts, buddies, me, unit, distUnit }: {
  gym: Gym; discoverable: boolean; counts: GymCounts; activity: { posts_7d: number; buddy_upcoming: number };
  posts: FeedPost[]; buddies: FeedPost[]; me: string; unit: WeightUnit; distUnit: DistanceUnit;
}) {
  const [buddyOpen, setBuddyOpen] = useState(false);
  return (
    <div className="max-w-2xl space-y-8">
      <Link href="/community" className="inline-flex h-10 items-center text-[14px] font-medium text-muted-foreground hover:text-foreground">← Community</Link>

      {/* Gym card */}
      <section className="rounded-xl border bg-card p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Dumbbell className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Forma Club</p>
            <h1 className="truncate text-[22px] font-bold tracking-[-0.02em]">{gym.name}</h1>
            <p className="flex items-center gap-1 truncate text-[13px] text-muted-foreground"><MapPin className="size-3.5" />{gymLocation(gym)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone={gym.verified ? "positive" : "outline"}>{gymBadge(gym)}</Badge>
          <Badge tone={discoverable ? "accent" : "neutral"}>{discoverable ? "You're discoverable here" : "You're not discoverable"}</Badge>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-4">
          <div><dt className="text-[12px] text-muted-foreground">Members you can find</dt><dd className="num text-[22px]">{counts.visible_members}</dd></div>
          <div><dt className="text-[12px] text-muted-foreground">Workouts shared this week</dt><dd className="num text-[22px]">{activity.posts_7d}</dd></div>
          <div><dt className="text-[12px] text-muted-foreground">Upcoming buddy invitations</dt><dd className="num text-[22px]">{activity.buddy_upcoming}</dd></div>
        </dl>
        <p className="mt-3 text-[12px] text-muted-foreground">Counts include only what you&apos;re allowed to see. Members who keep discovery off aren&apos;t counted.</p>
      </section>

      {/* Gym-buddy invitations */}
      <section aria-labelledby="buddy-h">
        <SectionTitle action={<Button size="sm" variant="outline" className="h-10" onClick={() => setBuddyOpen(true)}><Plus /> Find a buddy</Button>}><span id="buddy-h">Gym-buddy invitations</span></SectionTitle>
        {buddies.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title="No upcoming invitations">Planning a session? Post a time and see who at {gym.name} wants to join. Replies happen in the comments.</EmptyState>
        ) : (
          <div className="space-y-4">{buddies.map((p) => <PostCard key={p.id} post={p} me={me} unit={unit} distUnit={distUnit} />)}</div>
        )}
      </section>

      {/* Community activity */}
      <section aria-labelledby="activity-h">
        <SectionTitle><span id="activity-h">Community activity</span></SectionTitle>
        <FeedList posts={posts} me={me} unit={unit} distUnit={distUnit} empty={
          <EmptyState icon={<Users />} title="Nothing shared here yet">Workouts appear here only when members choose &ldquo;Gym community&rdquo; when sharing. Share one from History to get things started.</EmptyState>
        } />
      </section>

      <BuddySheet open={buddyOpen} onOpenChange={setBuddyOpen} gym={gym} />
    </div>
  );
}

function BuddySheet({ open, onOpenChange, gym }: { open: boolean; onOpenChange: (o: boolean) => void; gym: Gym }) {
  const router = useRouter();
  const zone0 = browserZone();
  const [f, setF] = useState(() => ({ date: wallParts(new Date(Date.now() + 86400000), zone0).date, time: "18:00", zone: zone0, workout: "", caption: "", id: crypto.randomUUID() }));
  const [busy, setBusy] = useState(false);
  const at = isValidZone(f.zone) ? zonedToUtc(f.date, f.time, f.zone) : null;
  async function submit() {
    if (!at) { toast.error("Pick a valid date, time and time zone."); return; }
    setBusy(true);
    try {
      const r = await postBuddy(createClient(), { id: f.id, audience: "gym", startsAt: at, timeZone: f.zone, workout: f.workout.trim(), caption: f.caption.trim() });
      if (r === "shared") { toast.success("Invitation posted"); onOpenChange(false); setF((x) => ({ ...x, caption: "", id: crypto.randomUUID() })); router.refresh(); }
      else toast.error(postOutcome(r));
    } catch { toast.error("Not posted. Check your connection and try again."); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Find a gym buddy" description="Post a time you plan to train. Nothing is scheduled or logged for you.">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Time"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
          </div>
          <Field label="Time zone"><Input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} /></Field>
          <Field label="Workout (optional)"><Input value={f.workout} maxLength={80} onChange={(e) => setF({ ...f, workout: e.target.value })} placeholder="e.g. Legs" /></Field>
          <Field label="Message (optional)"><Textarea value={f.caption} maxLength={500} rows={2} onChange={(e) => setF({ ...f, caption: e.target.value })} placeholder="e.g. Need a spotter for bench" /></Field>
        </div>
        <div className="mt-4 rounded-md border bg-muted/50 p-3 text-[13px]">
          <p className="font-semibold">Who will see this</p>
          <p className="mt-0.5 text-muted-foreground">Everyone who chose {gym.name} as their gym, including people who aren&apos;t your friends. They&apos;ll see your display name, {at ? formatInZone(at, f.zone) : "the time"}{f.workout.trim() ? `, "${f.workout.trim()}"` : ""}{f.caption.trim() ? " and your message" : ""}. Nothing else.</p>
        </div>
        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={busy || !at} onClick={submit}>{busy ? "Posting…" : "Post to gym community"}</Button>
      </SheetContent>
    </Sheet>
  );
}
