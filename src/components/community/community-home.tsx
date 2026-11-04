"use client";
import { Check, ChevronRight, Link2, MapPin, MessageCircle, Newspaper, ShieldAlert, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionTitle } from "@/components/ui/misc";
import {
  cancelFriendRequest, createInvite, respondFriendRequest, sendFriendRequest, unblockUser,
  type Blocked, type Friend, type FriendRequest, type GymCounts, type Membership, type Person,
} from "@/lib/data/social";
import { openConversation } from "@/lib/data/messages";
import { gymBadge, gymLocation, requestMessage, requestSucceeded, type Gym } from "@/lib/domain/social";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Panel, PersonMenu } from "./common";

export type CommunityData = {
  gym: Gym | null;
  membership: Membership | null;
  counts: GymCounts | null;
  people: Person[];
  friends: Friend[];
  requests: FriendRequest[];
  blocked: Blocked[];
  restricted: boolean;
  unread: number;
};

export function CommunityHome({ data, children }: { data: CommunityData; children?: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      const r = await fn();
      if (requestSucceeded(r)) toast.success(requestMessage(r)); else toast.error(requestMessage(r));
      router.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function makeInvite() {
    setBusy("invite");
    try {
      const code = await createInvite(createClient());
      const url = `${window.location.origin}/invite/${code}`;
      setInvite(url);
      if (navigator.share) { try { await navigator.share({ title: "Join me on Forma", url }); } catch { /* dismissed */ } }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  const incoming = data.requests.filter((r) => r.direction === "incoming");
  const outgoing = data.requests.filter((r) => r.direction === "outgoing");

  return (
    <div className="space-y-8">
      {data.restricted && (
        <div role="status" className="flex gap-3 rounded-lg border border-negative/30 bg-negative-soft p-4 text-[14px]">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-negative" />
          <p>Several people reported this account. Until the reports are reviewed you can't send friend requests, invites or messages.</p>
        </div>
      )}

      {children}

      <Link href="/community/messages" className="flex min-h-[68px] items-center gap-4 rounded-lg border bg-card px-4 py-3 shadow-card transition-colors hover:border-accent/50">
        <span className="grid size-10 place-items-center rounded-md bg-accent-soft text-accent"><MessageCircle className="size-[19px]" /></span>
        <span className="flex-1"><span className="block text-[16px] font-semibold tracking-tight">Messages</span><span className="block text-[13px] text-muted-foreground">Private conversations and invitations to train</span></span>
        {data.unread > 0 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-[12px] font-bold text-white" aria-label={`${data.unread} unread`}>{data.unread}</span>}
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
      <Link href="/community/feed" className="flex min-h-[68px] items-center gap-4 rounded-lg border bg-card px-4 py-3 shadow-card transition-colors hover:border-accent/50">
        <span className="grid size-10 place-items-center rounded-md bg-accent-soft text-accent"><Newspaper className="size-[19px]" /></span>
        <span className="flex-1"><span className="block text-[16px] font-semibold tracking-tight">Friends feed</span><span className="block text-[13px] text-muted-foreground">Workouts friends chose to share, and your own posts</span></span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>

      {/* Gym card */}
      <section aria-labelledby="gym-h">
        <SectionTitle action={data.gym ? <Link href="/community/gym" className="inline-flex h-10 items-center text-[13.5px] font-semibold text-accent">Gym settings</Link> : undefined}><span id="gym-h">My gym</span></SectionTitle>
        {data.gym ? (
          <Link href="/community/club" className="block rounded-lg border bg-card p-4 shadow-card transition-colors hover:border-accent/50">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><MapPin className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-semibold tracking-tight">{data.gym.name}</p>
                <p className="truncate text-[13px] text-muted-foreground">{gymLocation(data.gym)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={data.gym.verified ? "positive" : "outline"}>{gymBadge(data.gym)}</Badge>
                  <Badge tone={data.membership?.discoverable ? "accent" : "neutral"}>{data.membership?.discoverable ? "Discoverable here" : "Not discoverable"}</Badge>
                </div>
              </div>
              <ChevronRight className="mt-3 size-4 text-muted-foreground" />
            </div>
            {data.counts && (
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3">
                <div><dt className="text-[12.5px] text-muted-foreground">People you can find here</dt><dd className="num text-[22px]">{data.counts.visible_members}</dd></div>
                <div><dt className="text-[12.5px] text-muted-foreground">Friends here</dt><dd className="num text-[22px]">{data.counts.friends_here}</dd></div>
              </dl>
            )}
          </Link>
        ) : (
          <EmptyState icon={<MapPin />} title="Add your gym (optional)" action={<Button asChild variant="primary"><Link href="/community/gym">Choose gym</Link></Button>}>
            Find people who train at the same branch. Choosing a gym doesn't share anything and doesn't make you visible.
          </EmptyState>
        )}
      </section>

      {/* People at this gym */}
      {data.gym && (
        <section aria-labelledby="people-h">
          <SectionTitle><span id="people-h">People at {data.gym.name}</span></SectionTitle>
          {data.people.length === 0 ? (
            <EmptyState icon={<Users />} title="Nobody to show yet">
              Only people who turned on &ldquo;Let people at this gym discover me&rdquo; appear here. {data.membership?.discoverable ? "You're discoverable, so others can find you." : "You can turn it on in your gym settings."}
            </EmptyState>
          ) : (
            <Panel className="divide-y">
              {data.people.map((p) => (
                <div key={p.user_id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                  <Avatar name={p.display_name} />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.display_name}</span>
                  {p.relation === "friends" ? <Badge tone="positive"><Check /> Friends</Badge>
                    : p.relation === "request_sent" ? <Badge>Requested</Badge>
                    : (
                      <Button size="sm" variant={p.relation === "request_received" ? "primary" : "outline"} className="h-10"
                        disabled={busy === p.user_id || data.restricted}
                        onClick={() => run(p.user_id, () => sendFriendRequest(createClient(), p.user_id))}>
                        <UserPlus /> {p.relation === "request_received" ? "Accept" : "Add friend"}
                      </Button>
                    )}
                  <PersonMenu userId={p.user_id} name={p.display_name} isFriend={p.relation === "friends"} />
                </div>
              ))}
            </Panel>
          )}
        </section>
      )}

      {/* Requests */}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <section aria-labelledby="req-h">
          <SectionTitle><span id="req-h">Friend requests</span></SectionTitle>
          <Panel className="divide-y">
            {incoming.map((r) => (
              <div key={r.id} className="flex min-h-16 flex-wrap items-center gap-3 px-4 py-2.5">
                <Avatar name={r.display_name} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{r.display_name}</span><span className="text-[12.5px] text-muted-foreground">Wants to be friends</span></span>
                <Button size="sm" variant="primary" className="h-10" disabled={busy === r.id} onClick={() => run(r.id, () => respondFriendRequest(createClient(), r.id, true))}>Accept</Button>
                <Button size="sm" variant="ghost" className="h-10" disabled={busy === r.id} onClick={() => run(r.id, () => respondFriendRequest(createClient(), r.id, false))}>Decline</Button>
                <PersonMenu userId={r.other_id} name={r.display_name} isFriend={false} />
              </div>
            ))}
            {outgoing.map((r) => (
              <div key={r.id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                <Avatar name={r.display_name} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-semibold">{r.display_name}</span><span className="text-[12.5px] text-muted-foreground">Request sent</span></span>
                <Button size="sm" variant="quiet" className="h-10" disabled={busy === r.id} onClick={() => run(r.id, () => cancelFriendRequest(createClient(), r.id))}>Cancel</Button>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {/* Friends */}
      <section aria-labelledby="friends-h">
        <SectionTitle><span id="friends-h">Friends</span></SectionTitle>
        {data.friends.length === 0 ? (
          <EmptyState icon={<Users />} title="No friends yet">Add people from your gym, or send an invite link to someone you train with.</EmptyState>
        ) : (
          <Panel className="divide-y">
            {data.friends.map((f) => (
              <div key={f.user_id} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                <Avatar name={f.display_name} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{f.display_name}</span>
                <Button size="sm" variant="outline" className="h-10" disabled={busy === f.user_id || data.restricted}
                  onClick={async () => { setBusy(f.user_id); try { const id = await openConversation(createClient(), f.user_id); router.push(`/community/messages/${id}`); } catch (e) { toast.error((e as Error).message); setBusy(null); } }}>
                  <MessageCircle /> Message
                </Button>
                <PersonMenu userId={f.user_id} name={f.display_name} isFriend />
              </div>
            ))}
          </Panel>
        )}
        <div className="mt-3 rounded-lg border bg-card p-4 shadow-card">
          <p className="text-[14px] font-semibold">Invite someone you know</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">A single-use link, valid for 7 days. Whoever opens it can become your friend.</p>
          {invite ? (
            <div className="mt-3 flex gap-2">
              <input readOnly value={invite} aria-label="Invite link" className="h-10 min-w-0 flex-1 rounded-md border bg-muted px-3 text-[13px]" onFocus={(e) => e.target.select()} />
              <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(invite); toast.success("Link copied"); } catch { toast.error("Copy the link manually"); } }}>Copy</Button>
            </div>
          ) : (
            <Button className="mt-3" variant="outline" disabled={busy === "invite" || data.restricted} onClick={makeInvite}><Link2 /> Create invite link</Button>
          )}
        </div>
      </section>

      {/* Blocked */}
      {data.blocked.length > 0 && (
        <details className="rounded-lg border bg-card shadow-card">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[14px] font-semibold">Blocked people ({data.blocked.length})</summary>
          <div className="divide-y border-t">
            {data.blocked.map((b) => (
              <div key={b.user_id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-[14px]">{b.display_name}</span>
                <Button size="sm" variant="quiet" className="h-10" disabled={busy === b.user_id}
                  onClick={async () => { setBusy(b.user_id); try { await unblockUser(createClient(), b.user_id); toast.success("Unblocked"); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } }}>Unblock</Button>
              </div>
            ))}
          </div>
          <p className="border-t px-4 py-3 text-[12.5px] text-muted-foreground">Unblocking doesn&apos;t restore the friendship.</p>
        </details>
      )}
    </div>
  );
}
