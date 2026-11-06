"use client";
import { ArrowLeft, Ban, Bell, BellOff, CalendarClock, Flag, Info, Lock, MapPin, MoreHorizontal, RotateCw, Send, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  createTrainingInvite, loadInvites, loadMessages, markRead, respondTrainingInvite, sendMessage, setMuted,
  type ConversationInfo, type Message, type TrainingInvite,
} from "@/lib/data/messages";
import { blockUser } from "@/lib/data/social";
import { browserZone, formatInZone, inviteError, inviteStatusLabel, inviteTimeLines, isValidZone, messageError, wallParts, zonedToUtc } from "@/lib/domain/schedule";
import type { Gym } from "@/lib/domain/social";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar, Local, ReportSheet, useMounted, type ReportSubject } from "./common";

type Local = Message & { state?: "sending" | "failed"; error?: string };

const CAN_SEND_COPY: Record<string, string> = {
  not_friends: "You're no longer friends, so you can't send new messages. Earlier messages stay here.",
  unavailable: "You can't send messages in this conversation.",
  restricted: "Your account can't send messages while reports about it are reviewed.",
};

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function dayKey(iso: string) {
  return new Date(iso).toDateString();
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, days < 7 ? { weekday: "long" } : { weekday: "short", day: "numeric", month: "short" });
}
function gap(a: Message, b: Message) {
  return (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) / 1000;
}

/** An invitation that's still open and upcoming; while one exists the composer doesn't repeat the action. */
function openInviteFor(invites: Record<string, TrainingInvite>, _me: string): boolean {
  return Object.values(invites).some((i) => (i.status === "pending" || i.status === "accepted") && new Date(i.starts_at).getTime() > Date.now());
}

const EVENT_COPY: Record<string, string> = { accepted: "accepted the invitation", declined: "declined the invitation", proposed: "proposed a different time", cancelled: "cancelled the invitation" };

export function Conversation({ conversationId, me, info, initialMessages, initialInvites, myGym, workoutNames, live = true, openInvite = false }: {
  conversationId: string; me: string; info: ConversationInfo; initialMessages: Message[]; initialInvites: TrainingInvite[];
  myGym: Gym | null; workoutNames: string[];
  /** Open the invitation form right away (from a profile's "Invite to train"). */
  openInvite?: boolean;
  /** False only for fixture previews: no realtime, polling or read receipts. */
  live?: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Local[]>(initialMessages);
  const [invites, setInvites] = useState<Record<string, TrainingInvite>>(() => Object.fromEntries(initialInvites.map((i) => [i.id, i])));
  const [text, setText] = useState("");
  const [muted, setMutedState] = useState(info.muted);
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  const [inviteOpen, setInviteOpen] = useState(openInvite && info.can_send === "ok");
  const [infoOpen, setInfoOpen] = useState(false);
  const [proposeFor, setProposeFor] = useState<TrainingInvite | null>(null);
  const bottom = useRef<HTMLLIElement>(null);
  const canSend = info.can_send === "ok";
  // Day separators and times use the viewer's zone, so the list renders in the browser only.
  const mounted = useMounted();
  const name = info.display_name;

  const merge = useCallback((rows: Message[]) => {
    setMessages((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const r of rows) byId.set(r.id, { ...r });
      return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  const refresh = useCallback(async () => {
    const db = createClient();
    try {
      const [m, i] = await Promise.all([loadMessages(db, conversationId), loadInvites(db, conversationId)]);
      merge(m);
      setInvites(Object.fromEntries(i.map((x) => [x.id, x])));
    } catch { /* offline: keep what we have */ }
  }, [conversationId, merge]);

  // Live updates. RLS limits Realtime to the two participants; a slow poll covers dropped connections.
  useEffect(() => {
    if (!live) return;
    const db = createClient();
    const ch = db.channel(`conversation:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (p) => merge([p.new as Message]))
      .on("postgres_changes", { event: "*", schema: "public", table: "training_invites", filter: `conversation_id=eq.${conversationId}` },
        (p) => { const i = p.new as TrainingInvite; if (i?.id) setInvites((cur) => ({ ...cur, [i.id]: i })); })
      .subscribe();
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 20000);
    return () => { clearInterval(poll); void db.removeChannel(ch); };
  }, [conversationId, merge, refresh, live]);

  const lastIncoming = useMemo(() => [...messages].reverse().find((m) => m.sender_id !== me)?.id, [messages, me]);
  useEffect(() => {
    if (live && document.visibilityState === "visible") void markRead(createClient(), conversationId);
  }, [conversationId, lastIncoming, live]);
  useEffect(() => { requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" })); }, [messages.length, mounted]);

  async function deliver(m: Local) {
    setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, state: "sending", error: undefined } : x)));
    try {
      const r = await sendMessage(createClient(), m.id, info.other_id, m.body ?? "");
      if (r.status === "sent") {
        setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, state: undefined, created_at: r.created_at ?? x.created_at } : x)));
      } else {
        setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, state: "failed", error: messageError(r.status) } : x)));
      }
    } catch {
      setMessages((cur) => cur.map((x) => (x.id === m.id ? { ...x, state: "failed", error: messageError("network") } : x)));
    }
  }

  function send() {
    const body = text.trim();
    if (!body || !canSend) return;
    const m: Local = { id: uuid(), conversation_id: conversationId, sender_id: me, kind: "text", body, invite_id: null, created_at: new Date().toISOString(), state: "sending" };
    setMessages((cur) => [...cur, m]);
    setText("");
    void deliver(m);
  }

  async function act(i: TrainingInvite, action: "accept" | "decline" | "cancel") {
    if (action === "cancel" && !confirm("Cancel this invitation?")) return;
    try {
      const r = await respondTrainingInvite(createClient(), i.id, action, i.version);
      if (!["accepted", "declined", "cancelled"].includes(r)) toast.error(inviteError(r));
    } catch (e) { toast.error((e as Error).message); }
    await refresh();
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] max-w-2xl flex-col md:h-[calc(100dvh-5rem)]">
      <header className="-mx-4 flex items-center gap-2 border-b px-4 pb-2.5 md:mx-0 md:px-0">
        <Link href="/community/inbox" aria-label="Back to inbox" className="-ml-2.5 grid size-11 place-items-center rounded-full hover:bg-muted"><ArrowLeft className="size-[22px]" /></Link>
        <Link href={`/community/u/${info.other_id}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full pr-2">
          <Avatar name={name} id={info.other_id} className="size-9 text-[13px]" />
          <span className="min-w-0">
            <h1 className="truncate text-[16px] font-bold leading-tight tracking-tight">{name}</h1>
            {muted && <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><BellOff className="size-3" /> Muted</span>}
          </span>
        </Link>
        {canSend && <button type="button" onClick={() => setInviteOpen(true)} aria-label="Invite to train" className="grid size-11 place-items-center rounded-full hover:bg-muted"><CalendarClock className="size-[22px]" /></button>}
        <button type="button" onClick={() => setInfoOpen(true)} aria-label="Conversation details" className="-mr-2.5 grid size-11 place-items-center rounded-full hover:bg-muted"><Info className="size-[22px]" /></button>
      </header>

      <ol className="min-h-0 flex-1 overflow-y-auto py-4" aria-live="polite" aria-label={`Messages with ${name}`}>
        {messages.length === 0 && (
          <li className="flex flex-col items-center py-12 text-center">
            <Avatar name={name} id={info.other_id} className="size-20 text-[26px]" />
            <p className="mt-3 text-[17px] font-semibold">{name}</p>
            <p className="mt-1 text-[14px] text-muted-foreground">Say hi, or plan a session together.</p>
          </li>
        )}
        {mounted && messages.map((m, idx) => {
          const mine = m.sender_id === me;
          const prev = messages[idx - 1];
          const next = messages[idx + 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const sep = newDay ? <li key={`d-${m.id}`} className="py-3 text-center text-[12px] font-semibold text-muted-foreground">{dayLabel(m.created_at)}</li> : null;
          if (m.kind === "invite_event") {
            return [sep, <li key={m.id} className="py-1.5 text-center text-[12.5px] text-muted-foreground">{mine ? "You" : name} {EVENT_COPY[m.body ?? ""] ?? "updated the invitation"} · {clock(m.created_at)}</li>];
          }
          if (m.kind === "invite" && m.invite_id) {
            const inv = invites[m.invite_id];
            return [sep, <li key={m.id} className={cn("flex py-1.5", mine ? "justify-end" : "justify-start")}>{inv ? <InviteCard invite={inv} me={me} name={name} canAct={canSend} onAct={act} onPropose={setProposeFor} /> : null}</li>];
          }
          // Consecutive texts from the same person within a few minutes form one group; the time shows once, under the last.
          const joinsPrev = !newDay && prev?.kind === "text" && prev.sender_id === m.sender_id && gap(prev, m) < 300;
          const joinsNext = !!next && next.kind === "text" && next.sender_id === m.sender_id && dayKey(next.created_at) === dayKey(m.created_at) && gap(m, next) < 300;
          const status = m.state === "sending" ? "Sending…" : m.state === "failed" ? "Not sent" : !joinsNext ? clock(m.created_at) : null;
          return [sep, (
            <li key={m.id} className={cn("group flex items-end gap-1", mine ? "justify-end" : "justify-start", joinsPrev ? "mt-0.5" : "mt-3")}>
              {!mine && (
                <Menu>
                  <MenuTrigger className="order-last grid size-8 place-items-center rounded-full text-muted-foreground opacity-0 outline-none hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100" aria-label="Message options"><MoreHorizontal className="size-4" /></MenuTrigger>
                  <MenuContent align="start">
                    <MenuItem onSelect={() => setReporting({ type: "message", id: m.id, user: m.sender_id, label: "message" })}><Flag /> Report message</MenuItem>
                  </MenuContent>
                </Menu>
              )}
              <div className={cn("flex max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
                <div className={cn("rounded-[20px] px-3.5 py-2",
                  mine ? "bg-primary text-primary-foreground" : "bg-subtle",
                  mine ? (joinsPrev ? "rounded-tr-md" : "") + (joinsNext ? " rounded-br-md" : "") : (joinsPrev ? "rounded-tl-md" : "") + (joinsNext ? " rounded-bl-md" : ""),
                  m.state === "failed" && "opacity-60")}>
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{m.body}</p>
                </div>
                {status && <p className={cn("mt-1 px-1 text-[11px]", m.state === "failed" ? "text-destructive" : "text-muted-foreground")}>{status}</p>}
              </div>
              {m.state === "failed" && (
                <Button size="sm" variant="ghost" className="h-9 text-destructive" onClick={() => deliver(m)} aria-label={`Retry sending: ${m.error}`}><RotateCw /> Retry</Button>
              )}
            </li>
          )];
        })}
        {messages.filter((m) => m.state === "failed").slice(-1).map((m) => <li key={`err-${m.id}`} role="alert" className="mt-1 text-right text-[12.5px] text-destructive">{m.error}</li>)}
        <li ref={bottom} aria-hidden className="h-1" />
      </ol>

      {canSend ? (
        <div className="border-t pt-2.5">
        {!openInviteFor(invites, me) && (
          <button type="button" onClick={() => setInviteOpen(true)}
            className="mb-2.5 inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-3.5 text-[13.5px] font-semibold transition-colors hover:bg-muted active:scale-[0.97]">
            <CalendarClock className="size-4 text-accent" /> Invite to train
          </button>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} placeholder={`Message ${name}`} aria-label="Message"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] px-4 py-2.5"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <Button type="submit" variant="primary" size="icon" className="size-11 shrink-0 rounded-full" aria-label="Send" disabled={!text.trim()}><Send className="size-5" /></Button>
        </form>
        </div>
      ) : (
        <p className="border-t pt-3 text-center text-[13px] text-muted-foreground">{CAN_SEND_COPY[info.can_send] ?? CAN_SEND_COPY.unavailable}</p>
      )}

      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent title={name}>
          <div className="divide-y rounded-lg border">
            <button type="button" className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-muted" onClick={async () => {
              try { await setMuted(createClient(), conversationId, !muted); setMutedState(!muted); toast.success(muted ? "Unmuted" : "Muted. It won't count in your unread badge."); } catch (e) { toast.error((e as Error).message); }
            }}>{muted ? <Bell className="size-5" /> : <BellOff className="size-5" />} {muted ? "Unmute" : "Mute"}</button>
            <Link href={`/community/u/${info.other_id}`} className="flex min-h-12 items-center gap-3 px-4 text-[15px] hover:bg-muted"><UserRound className="size-5" /> View profile</Link>
            <button type="button" className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-muted" onClick={() => { setInfoOpen(false); setReporting({ type: "user", id: info.other_id, user: info.other_id, label: name }); }}><Flag className="size-5" /> Report {name}</button>
            <button type="button" className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] text-destructive hover:bg-destructive/10" onClick={async () => {
              if (!confirm(`Block ${name}? They won't be able to message or invite you, open invitations are cancelled, and they won't be told.`)) return;
              try { await blockUser(createClient(), info.other_id); toast.success(`${name} blocked`); router.push("/community"); router.refresh(); } catch (e) { toast.error((e as Error).message); }
            }}><Ban className="size-5" /> Block</button>
          </div>
          <section aria-labelledby="privacy-h" className="mt-5 flex gap-3 text-[13.5px]">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <h2 id="privacy-h" className="font-semibold">Privacy</h2>
              <p className="mt-0.5 text-muted-foreground">Only you and {name} can read this conversation in Forma. Messages are encrypted in transit and stored on Forma&apos;s servers; they aren&apos;t end-to-end encrypted. Reported messages are reviewed.</p>
            </div>
          </section>
        </SheetContent>
      </Sheet>
      <ReportSheet subject={reporting} onClose={() => setReporting(null)} onReported={() => { if (reporting?.type === "message") setMessages((cur) => cur.filter((x) => x.id !== reporting.id)); }} />
      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} to={info.other_id} name={name} myGym={myGym} workoutNames={workoutNames} onSent={refresh} />
      <ProposeSheet invite={proposeFor} onClose={() => setProposeFor(null)} onDone={refresh} />
    </div>
  );
}

function InviteCard({ invite: i, me, name, canAct, onAct, onPropose }: {
  invite: TrainingInvite; me: string; name: string; canAct: boolean;
  onAct: (i: TrainingInvite, a: "accept" | "decline" | "cancel") => void; onPropose: (i: TrainingInvite) => void;
}) {
  const starts = new Date(i.starts_at);
  const label = inviteStatusLabel(i.status, starts);
  const open = label === "Pending" || label === "Accepted";
  const myTurn = i.status === "pending" && i.awaiting_id === me;
  const fromMe = i.from_id === me;
  const tone = label === "Accepted" ? "positive" : label === "Pending" ? "accent" : "neutral";
  return (
    <div className="w-[min(100%,340px)] rounded-xl border bg-card p-3.5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-muted-foreground">{fromMe ? "You invited " + name : name + " invited you"} to train</p>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[15px] font-semibold"><MapPin className="size-4 text-accent" />{i.gym_name}</p>
      <Local>{() => inviteTimeLines(starts, i.time_zone, browserZone()).map((l, n) => <p key={n} className={n === 0 ? "mt-1 text-[14px]" : "text-[12.5px] text-muted-foreground"}>{l}</p>)}</Local>
      {i.workout_name && <p className="mt-1 text-[13px] text-muted-foreground">Workout: {i.workout_name}</p>}
      {i.note && <p className="mt-1 whitespace-pre-wrap text-[13px]">{i.note}</p>}
      {i.status === "pending" && i.proposed_by !== i.from_id && <p className="mt-1 text-[12.5px] text-muted-foreground">New time proposed by {i.proposed_by === me ? "you" : name}.</p>}
      {open && canAct && (
        <div className="mt-3 flex flex-wrap gap-2">
          {myTurn && <Button size="sm" variant="primary" className="h-10" onClick={() => onAct(i, "accept")}>Accept</Button>}
          {myTurn && <Button size="sm" variant="outline" className="h-10" onClick={() => onAct(i, "decline")}>Decline</Button>}
          {(myTurn || i.status === "accepted") && <Button size="sm" variant="outline" className="h-10" onClick={() => onPropose(i)}>{i.status === "accepted" ? "Reschedule" : "Propose time"}</Button>}
          {i.status === "pending" && !myTurn && <p className="w-full text-[12.5px] text-muted-foreground">Waiting for {name} to answer.</p>}
          <Button size="sm" variant="danger" className="h-10" onClick={() => onAct(i, "cancel")}>Cancel</Button>
        </div>
      )}
      {open && !canAct && <Button size="sm" variant="danger" className="mt-3 h-10" onClick={() => onAct(i, "cancel")}>Cancel invitation</Button>}
    </div>
  );
}

function defaultSlot(zone: string) {
  const t = new Date(Date.now() + 24 * 3600 * 1000);
  return { date: wallParts(t, zone).date, time: "18:00" };
}

function zoneList(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return []; }
}

function WhenFields({ date, time, zone, set }: { date: string; time: string; zone: string; set: (p: { date?: string; time?: string; zone?: string }) => void }) {
  const zones = useMemo(zoneList, []);
  const [editZone, setEditZone] = useState(false);
  const at = isValidZone(zone) ? zonedToUtc(date, time, zone) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date"><Input type="date" value={date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label="Time"><Input type="time" value={time} onChange={(e) => set({ time: e.target.value })} /></Field>
      </div>
      {editZone ? (
        <Field label="Time zone" hint="Both of you see the time in this zone, plus your own if it differs.">
          <Input list="tz-list" value={zone} onChange={(e) => set({ zone: e.target.value })} />
          <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </Field>
      ) : null}
      <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
        {at ? <span className="font-medium text-foreground">{formatInZone(at, zone)}</span> : "Pick a date and time that exists in this time zone."}
        {!editZone && <> · <button type="button" className="font-semibold text-foreground underline-offset-2 hover:underline" onClick={() => setEditZone(true)}>Change time zone</button></>}
      </p>
    </>
  );
}

function InviteSheet({ open, onOpenChange, to, name, myGym, workoutNames, onSent }: {
  open: boolean; onOpenChange: (o: boolean) => void; to: string; name: string; myGym: Gym | null; workoutNames: string[]; onSent: () => void;
}) {
  const zone0 = browserZone();
  const [f, setF] = useState(() => ({ gym: myGym?.name ?? "", ...defaultSlot(zone0), zone: zone0, workout: "", note: "", id: uuid() }));
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!f.gym.trim()) { toast.error(inviteError("invalid_gym")); return; }
    if (!isValidZone(f.zone)) { toast.error(inviteError("invalid_time_zone")); return; }
    const at = zonedToUtc(f.date, f.time, f.zone);
    if (!at) { toast.error("That date and time doesn't exist in this time zone."); return; }
    setBusy(true);
    try {
      const r = await createTrainingInvite(createClient(), {
        id: f.id, to, gymId: myGym && f.gym.trim() === myGym.name ? myGym.id : null, gymName: f.gym.trim(),
        startsAt: at, timeZone: f.zone, workout: f.workout.trim(), note: f.note.trim(),
      });
      if (r === "sent") { onOpenChange(false); setF((x) => ({ ...x, note: "", id: uuid() })); onSent(); }
      else toast.error(inviteError(r));
    } catch { toast.error("Not sent. Check your connection and try again."); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Invite to train" description={`Only you and ${name} see this. It doesn't create or log a workout.`}>
        <div className="space-y-3">
          <Field label="Gym">
            <Input list="gym-list" value={f.gym} maxLength={120} onChange={(e) => setF({ ...f, gym: e.target.value })} placeholder="Where you'll train" />
            {myGym && <datalist id="gym-list"><option value={myGym.name} /></datalist>}
          </Field>
          <WhenFields date={f.date} time={f.time} zone={f.zone} set={(p) => setF({ ...f, ...p })} />
          <Field label="Workout (optional)">
            <Input list="workout-list" value={f.workout} maxLength={80} onChange={(e) => setF({ ...f, workout: e.target.value })} placeholder="e.g. Push" />
            <datalist id="workout-list">{workoutNames.map((w) => <option key={w} value={w} />)}</datalist>
          </Field>
          <Field label="Note (optional)"><Textarea value={f.note} maxLength={300} rows={2} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Send invitation"}</Button>
      </SheetContent>
    </Sheet>
  );
}

function ProposeSheet({ invite, onClose, onDone }: { invite: TrainingInvite | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ date: "", time: "", zone: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (invite) { const w = wallParts(new Date(invite.starts_at), invite.time_zone); setF({ date: w.date, time: w.time, zone: invite.time_zone }); }
  }, [invite]);
  async function submit() {
    if (!invite) return;
    const at = isValidZone(f.zone) ? zonedToUtc(f.date, f.time, f.zone) : null;
    if (!at) { toast.error("Pick a valid date, time and time zone."); return; }
    setBusy(true);
    try {
      const r = await respondTrainingInvite(createClient(), invite.id, "propose", invite.version, { startsAt: at, timeZone: f.zone });
      if (r === "proposed") { onClose(); } else toast.error(inviteError(r));
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); onDone(); }
  }
  return (
    <Sheet open={!!invite} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent title="Propose a different time" description="The other person has to accept it before it's confirmed.">
        <div className="space-y-3"><WhenFields date={f.date} time={f.time} zone={f.zone} set={(p) => setF({ ...f, ...p })} /></div>
        <Button variant="primary" size="lg" className="mt-4 w-full" disabled={busy} onClick={submit}>{busy ? "Sending…" : "Propose time"}</Button>
      </SheetContent>
    </Sheet>
  );
}
