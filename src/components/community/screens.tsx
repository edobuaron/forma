"use client";
// Community screens. Every screen takes its data as props so the pages stay thin and the
// screens can be checked with fixture data.
import { format } from "date-fns";
import { BellOff, CalendarClock, Check, ChevronRight, Link2, MapPin, Plus, Search, Settings2, ShieldAlert, SquarePen, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { openConversation, type ConversationSummary } from "@/lib/data/messages";
import { postBuddy, postOutcome, type Audience, type FeedPost } from "@/lib/data/posts";
import {
  cancelFriendRequest, createInvite, respondFriendRequest, sendFriendRequest, setDiscoverable, unblockUser,
  type Blocked, type Friend, type FriendRequest, type Membership, type Person,
} from "@/lib/data/social";
import type { DistanceUnit } from "@/lib/domain/running";
import { browserZone, formatInZone, isValidZone, wallParts, zonedToUtc } from "@/lib/domain/schedule";
import { gymLocation, requestMessage, requestSucceeded, type Gym, type Relation } from "@/lib/domain/social";
import type { WeightUnit } from "@/lib/domain/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar, Empty, Local, Panel, PersonMenu } from "./common";
import { CommunityHeader, Tabs } from "./header";
import { FeedList, PostCard } from "./post-card";

type Units = { me: string; unit: WeightUnit; distUnit: DistanceUnit };

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      const r = await fn();
      if (requestSucceeded(r)) toast.success(requestMessage(r)); else toast.error(requestMessage(r));
      router.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  return { busy, setBusy, run };
}

export function RestrictedNote() {
  return (
    <div role="status" className="mb-4 flex gap-3 rounded-lg border border-negative/30 bg-negative-soft p-3.5 text-[14px]">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-negative" />
      <p>Several people reported this account. Until the reports are reviewed you can&apos;t send requests, invites, messages or posts.</p>
    </div>
  );
}

/** Creates a single-use invite link and opens the share sheet, or shows the link to copy. */
export function InviteFriendButton({ variant = "outline", className, disabled, label = "Invite a friend" }: {
  variant?: "primary" | "outline" | "secondary"; className?: string; disabled?: boolean; label?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function make() {
    setBusy(true);
    try {
      const code = await createInvite(createClient());
      const link = `${window.location.origin}/invite/${code}`;
      if (navigator.share) { try { await navigator.share({ title: "Join me on Forma", url: link }); return; } catch { /* dismissed: show the link */ } }
      setUrl(link);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <>
      <Button variant={variant} className={className} disabled={busy || disabled} onClick={make}><Link2 /> {label}</Button>
      <Sheet open={!!url} onOpenChange={(o) => { if (!o) setUrl(null); }}>
        <SheetContent title="Invite link" description="Single use, valid for 7 days. Whoever opens it can become your friend.">
          <div className="flex gap-2">
            <input readOnly value={url ?? ""} aria-label="Invite link" className="h-11 min-w-0 flex-1 rounded-md border bg-muted px-3 text-[13px]" onFocus={(e) => e.target.select()} />
            <Button variant="primary" className="h-11" onClick={async () => { try { await navigator.clipboard.writeText(url ?? ""); toast.success("Link copied"); } catch { toast.error("Copy the link manually"); } }}>Copy</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ Feed */

export type FeedScreenData = Units & {
  tab: "friends" | "gym"; unread: number; restricted: boolean;
  friends: Friend[]; incoming: FriendRequest[]; posts: FeedPost[];
  gym: Gym | null; membership: Membership | null; buddies: FeedPost[];
};

export function FeedScreen(d: FeedScreenData) {
  return (
    <div className="mx-auto max-w-[600px]">
      <CommunityHeader title="Community" unread={d.unread} />
      <Tabs items={[
        { href: "/community", label: "Friends", on: d.tab === "friends" },
        { href: "/community?tab=gym", label: "My gym", on: d.tab === "gym" },
      ]} />
      {d.restricted && <RestrictedNote />}
      {d.tab === "friends" ? <FriendsFeed {...d} /> : <GymFeed {...d} />}
    </div>
  );
}

function FriendsFeed(d: FeedScreenData) {
  return (
    <>
      {d.incoming.length > 0 && <RequestRows requests={d.incoming} className="mb-5" />}
      {d.friends.length > 0 && <FriendStrip friends={d.friends} />}
      <FeedList key="friends" posts={d.posts} me={d.me} unit={d.unit} distUnit={d.distUnit} empty={
        d.friends.length === 0 ? (
          <Empty title="Your feed starts with friends" className="py-14"
            actions={<><Button asChild variant="primary" size="lg"><Link href="/community/find"><UserPlus /> Find friends</Link></Button><InviteFriendButton className="h-12 px-5" disabled={d.restricted} /></>}>
            Add people you train with to see the workouts they share.
          </Empty>
        ) : (
          <Empty title="No posts yet" className="py-14"
            actions={<Button asChild variant="primary"><Link href="/community/share">Share a workout</Link></Button>}>
            Workouts your friends share show up here.
          </Empty>
        )
      } />
    </>
  );
}

/** Horizontal row of friends, like story avatars: tap to open a profile. */
function FriendStrip({ friends }: { friends: Friend[] }) {
  return (
    <nav aria-label="Friends" className="-mx-4 mb-5 flex gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
      <Link href="/community/find" className="flex w-16 shrink-0 flex-col items-center gap-1.5">
        <span className="grid size-[60px] place-items-center rounded-full border-2 border-dashed border-input text-muted-foreground"><Plus className="size-6" /></span>
        <span className="w-full truncate text-center text-[12px] text-muted-foreground">Add</span>
      </Link>
      {friends.map((f) => (
        <Link key={f.user_id} href={`/community/u/${f.user_id}`} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
          <span className="rounded-full p-[2px] ring-2 ring-accent/70"><Avatar name={f.display_name} id={f.user_id} className="size-[54px] text-[17px]" /></span>
          <span className="w-full truncate text-center text-[12px]">{f.display_name.split(" ")[0]}</span>
        </Link>
      ))}
    </nav>
  );
}

function RequestRows({ requests, className }: { requests: FriendRequest[]; className?: string }) {
  const { busy, run } = useRun();
  return (
    <section aria-label="Friend requests" className={className}>
      <Panel className="divide-y">
        {requests.map((r) => r.direction === "incoming" ? (
          <div key={r.id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
            <Avatar name={r.display_name} id={r.other_id} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{r.display_name}</span><span className="text-[13px] text-muted-foreground">Friend request</span></span>
            <Button size="sm" variant="primary" className="h-10" disabled={busy === r.id} onClick={() => run(r.id, () => respondFriendRequest(createClient(), r.id, true))}>Accept</Button>
            <Button size="sm" variant="ghost" className="h-10" disabled={busy === r.id} onClick={() => run(r.id, () => respondFriendRequest(createClient(), r.id, false))}>Decline</Button>
          </div>
        ) : (
          <div key={r.id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
            <Avatar name={r.display_name} id={r.other_id} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{r.display_name}</span><span className="text-[13px] text-muted-foreground">Request sent</span></span>
            <Button size="sm" variant="quiet" className="h-10" disabled={busy === r.id} onClick={() => run(r.id, () => cancelFriendRequest(createClient(), r.id))}>Cancel</Button>
          </div>
        ))}
      </Panel>
    </section>
  );
}

/** The compact prompt shown wherever a gym hasn't been chosen. */
export function ChooseGymRow({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-16 items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-card", className)}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><MapPin className="size-5" /></span>
      <span className="min-w-0 flex-1 text-[15px] font-semibold">Find people at your gym</span>
      <Button asChild size="sm" variant="primary" className="h-10"><Link href="/community/gym">Choose gym</Link></Button>
    </div>
  );
}

function GymHeader({ gym, discoverable }: { gym: Gym; discoverable: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><MapPin className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2"><span className="truncate text-[16px] font-bold tracking-tight">{gym.name}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", gym.verified ? "bg-positive-soft text-positive" : "bg-subtle text-muted-foreground")}>{gym.verified ? "Verified" : "Unofficial"}</span></p>
        <p className="truncate text-[13px] text-muted-foreground">{gymLocation(gym)}{discoverable ? "" : " · You're hidden"}</p>
      </div>
      <Link href="/community/gym" aria-label="Gym settings" className="grid size-11 place-items-center rounded-full hover:bg-muted"><Settings2 className="size-5" /></Link>
    </div>
  );
}

function GymFeed(d: FeedScreenData) {
  const [buddyOpen, setBuddyOpen] = useState(false);
  if (!d.gym) return <ChooseGymRow />;
  const gym = d.gym;
  return (
    <>
      <GymHeader gym={gym} discoverable={!!d.membership?.discoverable} />
      <div className="mb-5 grid grid-cols-2 gap-2">
        <Button asChild variant="secondary" className="h-11"><Link href="/community/find"><UserPlus /> People here</Link></Button>
        <Button variant="secondary" className="h-11" disabled={d.restricted} onClick={() => setBuddyOpen(true)}><CalendarClock /> Find a buddy</Button>
      </div>
      {d.buddies.length > 0 && (
        <section aria-labelledby="buddy-h" className="mb-6">
          <h2 id="buddy-h" className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Training sessions</h2>
          <div className="space-y-4">{d.buddies.map((p) => <PostCard key={p.id} post={p} me={d.me} unit={d.unit} distUnit={d.distUnit} />)}</div>
        </section>
      )}
      <FeedList key="gym" posts={d.posts} me={d.me} unit={d.unit} distUnit={d.distUnit} empty={
        <Empty title={`Nothing shared at ${gym.name} yet`} actions={<Button asChild variant="primary"><Link href="/community/share">Share a workout</Link></Button>} />
      } />
      <BuddySheet open={buddyOpen} onOpenChange={setBuddyOpen} gym={gym} />
    </>
  );
}

/* --------------------------------------------------------------- Buddy post */

export function BuddySheet({ open, onOpenChange, gym }: { open: boolean; onOpenChange: (o: boolean) => void; gym: Gym | null }) {
  const router = useRouter();
  const zone0 = browserZone();
  const [f, setF] = useState(() => ({ date: wallParts(new Date(Date.now() + 86400000), zone0).date, time: "18:00", zone: zone0, workout: "", caption: "", id: crypto.randomUUID() }));
  const [audience, setAudience] = useState<Audience>(gym ? "gym" : "friends");
  const [busy, setBusy] = useState(false);
  const at = isValidZone(f.zone) ? zonedToUtc(f.date, f.time, f.zone) : null;
  async function submit() {
    if (!at) { toast.error("Pick a valid date, time and time zone."); return; }
    setBusy(true);
    try {
      const r = await postBuddy(createClient(), { id: f.id, audience, startsAt: at, timeZone: f.zone, workout: f.workout.trim(), caption: f.caption.trim() });
      if (r === "shared") { toast.success("Invitation posted"); onOpenChange(false); setF((x) => ({ ...x, caption: "", id: crypto.randomUUID() })); router.refresh(); }
      else toast.error(postOutcome(r));
    } catch { toast.error("Not posted. Check your connection and try again."); } finally { setBusy(false); }
  }
  const who = audience === "gym" && gym
    ? `Everyone who chose ${gym.name} as their gym, including people who aren't your friends`
    : "Only your friends";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Find a training buddy">
        <div className="space-y-3">
          {gym && (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1" role="radiogroup" aria-label="Who can see it">
              {(["gym", "friends"] as const).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={audience === a} onClick={() => setAudience(a)}
                  className={cn("h-10 rounded-md text-[14px] font-semibold", audience === a ? "bg-card shadow-card" : "text-muted-foreground")}>
                  {a === "gym" ? "My gym" : "Friends"}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Time"><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
          </div>
          <Field label="Time zone"><Input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} /></Field>
          <Field label="Workout (optional)"><Input value={f.workout} maxLength={80} onChange={(e) => setF({ ...f, workout: e.target.value })} placeholder="e.g. Legs" /></Field>
          <Field label="Message (optional)"><Textarea value={f.caption} maxLength={500} rows={2} onChange={(e) => setF({ ...f, caption: e.target.value })} placeholder="e.g. Need a spotter for bench" /></Field>
        </div>
        <p className="mt-4 rounded-md bg-muted/60 p-3 text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">Who sees this: </span>{who}. They&apos;ll see your name, {at ? formatInZone(at, f.zone) : "the time"}{f.workout.trim() ? `, "${f.workout.trim()}"` : ""}{f.caption.trim() ? " and your message" : ""}.
        </p>
        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={busy || !at} onClick={submit}>{busy ? "Posting…" : "Post"}</Button>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ Profile */

export type MyProfileData = Units & {
  name: string; tab: "posts" | "friends"; unread: number; restricted: boolean;
  friends: Friend[]; requests: FriendRequest[]; blocked: Blocked[]; posts: FeedPost[]; gym: Gym | null;
};

function ProfileTop({ id, name, sub, children }: { id: string; name: string; sub: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-4">
      <Avatar name={name} id={id} className="size-20 text-[26px] md:size-24 md:text-[30px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[21px] font-bold tracking-[-0.02em]">{name}</p>
        <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">{sub}</p>
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    </div>
  );
}

export function MyProfileScreen(d: MyProfileData) {
  const { busy, setBusy } = useRun();
  const router = useRouter();
  const pending = d.requests.length;
  return (
    <div className="mx-auto max-w-[600px]">
      <CommunityHeader title="Profile" back={{ href: "/community", label: "Back to Community" }} unread={d.unread} />
      {d.restricted && <RestrictedNote />}
      <ProfileTop id={d.me} name={d.name} sub={<>{d.friends.length} {d.friends.length === 1 ? "friend" : "friends"}{d.gym ? ` · ${d.gym.name}` : ""}</>}>
        <InviteFriendButton variant="secondary" className="h-10" disabled={d.restricted} />
        <Button asChild variant="secondary" className="h-10"><Link href="/community/gym"><MapPin /> {d.gym ? "Gym and visibility" : "Choose gym"}</Link></Button>
      </ProfileTop>
      {pending > 0 && <RequestRows requests={d.requests} className="mb-5" />}
      <Tabs items={[
        { href: "/community/me", label: "Posts", on: d.tab === "posts" },
        { href: "/community/me?tab=friends", label: `Friends${d.friends.length ? ` · ${d.friends.length}` : ""}`, on: d.tab === "friends" },
      ]} />
      {d.tab === "posts" ? (
        <FeedList key="mine" posts={d.posts} me={d.me} unit={d.unit} distUnit={d.distUnit} empty={
          <Empty title="No posts yet" actions={<Button asChild variant="primary"><Link href="/community/share">Share a workout</Link></Button>}>
            You choose who sees each post when you share it.
          </Empty>
        } />
      ) : (
        <>
          {d.friends.length === 0 ? (
            <Empty title="No friends yet" actions={<Button asChild variant="primary"><Link href="/community/find"><UserPlus /> Find friends</Link></Button>} />
          ) : (
            <Panel className="divide-y">
              {d.friends.map((f) => (
                <div key={f.user_id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                  <Link href={`/community/u/${f.user_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={f.display_name} id={f.user_id} />
                    <span className="truncate text-[15px] font-semibold">{f.display_name}</span>
                  </Link>
                  <Button size="sm" variant="secondary" className="h-10" disabled={busy === f.user_id || d.restricted}
                    onClick={async () => { setBusy(f.user_id); try { router.push(`/community/messages/${await openConversation(createClient(), f.user_id)}`); } catch (e) { toast.error((e as Error).message); setBusy(null); } }}>
                    Message
                  </Button>
                  <PersonMenu userId={f.user_id} name={f.display_name} isFriend />
                </div>
              ))}
            </Panel>
          )}
          {d.blocked.length > 0 && <BlockedList blocked={d.blocked} />}
        </>
      )}
    </div>
  );
}

function BlockedList({ blocked }: { blocked: Blocked[] }) {
  const { busy, setBusy } = useRun();
  const router = useRouter();
  return (
    <details className="mt-5 rounded-lg border bg-card shadow-card">
      <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[14px] font-semibold">Blocked · {blocked.length}</summary>
      <div className="divide-y border-t">
        {blocked.map((b) => (
          <div key={b.user_id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[14px]">{b.display_name}</span>
            <Button size="sm" variant="quiet" className="h-10" disabled={busy === b.user_id}
              onClick={async () => { setBusy(b.user_id); try { await unblockUser(createClient(), b.user_id); toast.success("Unblocked. You're not friends again until one of you sends a request."); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } }}>Unblock</Button>
          </div>
        ))}
      </div>
    </details>
  );
}

export type PersonProfileData = Units & {
  person: { id: string; name: string; relation: Relation; requestId?: string };
  unread: number; restricted: boolean; posts: FeedPost[]; gymName: string | null;
};

export function PersonProfileScreen(d: PersonProfileData) {
  const router = useRouter();
  const { busy, setBusy, run } = useRun();
  const p = d.person;
  const friends = p.relation === "friends";
  const sub = friends ? "Friends" : p.relation === "request_sent" ? "Request sent" : p.relation === "request_received" ? "Wants to be friends" : d.gymName ? `Trains at ${d.gymName}` : "";
  return (
    <div className="mx-auto max-w-[600px]">
      <CommunityHeader title={p.name} back={{ href: "/community", label: "Back to Community" }} unread={d.unread}
        actions={<PersonMenu userId={p.id} name={p.name} isFriend={friends} onChanged={() => router.push("/community")} />} />
      <ProfileTop id={p.id} name={p.name} sub={sub}>
        {friends ? (
          <Button variant="primary" className="h-10 px-6" disabled={busy === "msg" || d.restricted}
            onClick={async () => { setBusy("msg"); try { router.push(`/community/messages/${await openConversation(createClient(), p.id)}`); } catch (e) { toast.error((e as Error).message); setBusy(null); } }}>
            Message
          </Button>
        ) : p.relation === "request_received" && p.requestId ? (
          <>
            <Button variant="primary" className="h-10" disabled={busy === p.requestId} onClick={() => run(p.requestId!, () => respondFriendRequest(createClient(), p.requestId!, true))}>Accept</Button>
            <Button variant="secondary" className="h-10" disabled={busy === p.requestId} onClick={() => run(p.requestId!, () => respondFriendRequest(createClient(), p.requestId!, false))}>Decline</Button>
          </>
        ) : p.relation === "none" ? (
          <Button variant="primary" className="h-10" disabled={busy === p.id || d.restricted} onClick={() => run(p.id, () => sendFriendRequest(createClient(), p.id))}><UserPlus /> Add friend</Button>
        ) : null}
      </ProfileTop>
      <FeedList key={p.id} posts={d.posts} me={d.me} unit={d.unit} distUnit={d.distUnit} empty={
        <Empty title="No posts to show">{friends ? `${p.name.split(" ")[0]} hasn't shared anything with you yet.` : "Become friends to see what they share with friends."}</Empty>
      } />
    </div>
  );
}

/* -------------------------------------------------------------------- Inbox */

function when(iso: string) {
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86400000;
  if (new Date().toDateString() === d.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days < 6) return format(d, "EEE");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function InboxScreen({ conversations, friends, requests, unread, restricted }: {
  conversations: ConversationSummary[]; friends: Friend[]; requests: number; unread: number; restricted: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const newBtn = (
    <button type="button" onClick={() => setPicking(true)} aria-label="New message" disabled={restricted}
      className="-mr-2.5 grid size-11 place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
      <SquarePen className="size-[22px]" strokeWidth={1.9} />
    </button>
  );
  return (
    <div className="mx-auto max-w-[600px]">
      <CommunityHeader title="Inbox" back={{ href: "/community", label: "Back to Community" }} unread={unread} showNav={false} actions={newBtn} />
      {restricted && <RestrictedNote />}
      {requests > 0 && (
        <Link href="/community/me" className="mb-4 flex min-h-14 items-center gap-3 rounded-lg border bg-card px-4 shadow-card hover:bg-muted/60">
          <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent"><UserPlus className="size-[18px]" /></span>
          <span className="flex-1 text-[15px] font-semibold">Friend requests</span>
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-[12px] font-bold text-white">{requests}</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      )}
      {conversations.length === 0 ? (
        <Empty title="No messages yet" className="py-14" actions={
          friends.length > 0
            ? <Button variant="primary" size="lg" disabled={restricted} onClick={() => setPicking(true)}><SquarePen /> New message</Button>
            : <Button asChild variant="primary" size="lg"><Link href="/community/find"><UserPlus /> Find friends</Link></Button>
        }>{friends.length > 0 ? "Message a friend or invite them to train." : "You can message people once you're friends."}</Empty>
      ) : (
        <ul className="-mx-2">
          {conversations.map((c) => {
            const preview = c.last_kind === "text" ? c.last_body : c.last_kind === "invite" ? "Invitation to train" : "Invitation updated";
            const hot = c.unread > 0;
            return (
              <li key={c.conversation_id}>
                <Link href={`/community/messages/${c.conversation_id}`} className="flex min-h-[72px] items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                  <Avatar name={c.display_name} id={c.other_id} className="size-14 text-[18px]" />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[15.5px]", hot ? "font-bold" : "font-semibold")}>{c.display_name}</span>
                    <span className="flex items-center gap-1 text-[14px]">
                      <span className={cn("truncate", hot ? "font-semibold text-foreground" : "text-muted-foreground")}>{c.last_from_me ? "You: " : ""}{preview}</span>
                      <span className="shrink-0 text-muted-foreground"><Local>{() => `· ${when(c.last_message_at)}`}</Local></span>
                      {c.muted && <BellOff aria-label="Muted" className="size-3.5 shrink-0 text-muted-foreground" />}
                    </span>
                  </span>
                  {hot && <span className="size-2.5 shrink-0 rounded-full bg-accent" aria-label={`${c.unread} unread`} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <FriendPicker open={picking} onOpenChange={setPicking} friends={friends} />
    </div>
  );
}

function FriendPicker({ open, onOpenChange, friends }: { open: boolean; onOpenChange: (o: boolean) => void; friends: Friend[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useMemo(() => friends.filter((f) => f.display_name.toLowerCase().includes(q.trim().toLowerCase())), [friends, q]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="New message">
        {friends.length === 0 ? (
          <Empty title="No friends yet" className="py-6" actions={<Button asChild variant="primary"><Link href="/community/find">Find friends</Link></Button>} />
        ) : (
          <>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" aria-label="Search friends" className="h-11 pl-9" />
            </label>
            <ul className="-mx-2 mt-2 max-h-[50dvh] overflow-y-auto">
              {list.map((f) => (
                <li key={f.user_id}>
                  <button type="button" disabled={!!busy} className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-muted disabled:opacity-60"
                    onClick={async () => { setBusy(f.user_id); try { router.push(`/community/messages/${await openConversation(createClient(), f.user_id)}`); } catch (e) { toast.error((e as Error).message); setBusy(null); } }}>
                    <Avatar name={f.display_name} id={f.user_id} />
                    <span className="flex-1 truncate text-[15px] font-semibold">{f.display_name}</span>
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="py-6 text-center text-[14px] text-muted-foreground">No friend called &ldquo;{q}&rdquo;</li>}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* --------------------------------------------------------------------- Find */

export function FindScreen({ gym, membership, people, restricted, unread }: {
  gym: Gym | null; membership: Membership | null; people: Person[]; restricted: boolean; unread: number;
}) {
  const router = useRouter();
  const { busy, run } = useRun();
  const [disc, setDisc] = useState(!!membership?.discoverable);
  return (
    <div className="mx-auto max-w-[600px]">
      <CommunityHeader title="Find friends" back={{ href: "/community", label: "Back to Community" }} unread={unread} />
      {restricted && <RestrictedNote />}
      <div className="mb-6 flex min-h-16 items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-card">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Link2 className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Invite a friend</span><span className="block text-[13px] text-muted-foreground">Send them a single-use link</span></span>
        <InviteFriendButton variant="primary" className="h-10" label="Invite" disabled={restricted} />
      </div>

      {!gym ? <ChooseGymRow /> : (
        <section aria-labelledby="gym-people">
          <GymHeader gym={gym} discoverable={disc} />
          <label className="mb-4 flex min-h-14 items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-card">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Let people here find me</span>
              <span className="block text-[13px] text-muted-foreground">Shows only your name to members of {gym.name}. Off by default; switching gym turns it off.</span>
            </span>
            <Switch checked={disc} aria-label="Let people at this gym find me" onCheckedChange={async (v) => {
              setDisc(v);
              try { await setDiscoverable(createClient(), v); router.refresh(); } catch (e) { setDisc(!v); toast.error((e as Error).message); }
            }} />
          </label>
          <h2 id="gym-people" className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">People at {gym.name}</h2>
          {people.length === 0 ? (
            <Empty title="Nobody to show yet" className="py-8">Only members who let people find them appear here.</Empty>
          ) : (
            <Panel className="divide-y">
              {people.map((p) => (
                <div key={p.user_id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                  <Link href={`/community/u/${p.user_id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={p.display_name} id={p.user_id} />
                    <span className="truncate text-[15px] font-semibold">{p.display_name}</span>
                  </Link>
                  {p.relation === "friends" ? <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-positive"><Check className="size-4" /> Friends</span>
                    : p.relation === "request_sent" ? <span className="text-[13px] font-medium text-muted-foreground">Requested</span>
                    : (
                      <Button size="sm" variant={p.relation === "request_received" ? "primary" : "secondary"} className="h-10"
                        disabled={busy === p.user_id || restricted} onClick={() => run(p.user_id, () => sendFriendRequest(createClient(), p.user_id))}>
                        {p.relation === "request_received" ? "Accept" : "Add"}
                      </Button>
                    )}
                </div>
              ))}
            </Panel>
          )}
        </section>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- Share */

export type ShareableSession = { id: string; name: string; started_at: string; exercise_count: number; set_count: number; shared: boolean };

export function ShareChooser({ sessions, gym, unread, restricted }: { sessions: ShareableSession[]; gym: Gym | null; unread: number; restricted: boolean }) {
  const [buddyOpen, setBuddyOpen] = useState(false);
  return (
    <div className="mx-auto max-w-[600px]">
      <CommunityHeader title="Share" back={{ href: "/community", label: "Back to Community" }} unread={unread} showNav={false} />
      {restricted && <RestrictedNote />}
      <button type="button" disabled={restricted} onClick={() => setBuddyOpen(true)}
        className="mb-6 flex min-h-16 w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left shadow-card hover:bg-muted/60 disabled:opacity-50">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><CalendarClock className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">Find a training buddy</span><span className="block text-[13px] text-muted-foreground">Post a time you plan to train</span></span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Share a workout</h2>
      {sessions.length === 0 ? (
        <Empty title="No finished workouts yet" className="py-8" actions={<Button asChild variant="primary"><Link href="/workout">Start a workout</Link></Button>} />
      ) : (
        <Panel className="divide-y">
          {sessions.map((s) => (
            <Link key={s.id} href={`/community/share/${s.id}`} className="flex min-h-16 items-center gap-3 px-4 py-2.5 hover:bg-muted/60">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-subtle text-center leading-none">
                <Local>{() => <span><span className="block text-[10.5px] font-semibold uppercase text-muted-foreground">{format(new Date(s.started_at), "MMM")}</span><span className="num block text-[16px]">{format(new Date(s.started_at), "d")}</span></span>}</Local>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{s.name}</span>
                <span className="block text-[13px] text-muted-foreground">{s.exercise_count} exercises · {s.set_count} sets{s.shared ? " · Shared" : ""}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          ))}
        </Panel>
      )}
      <BuddySheet open={buddyOpen} onOpenChange={setBuddyOpen} gym={gym} />
    </div>
  );
}
