"use client";
import { formatDistanceToNowStrict } from "date-fns";
import { CalendarClock, Flag, Heart, MapPin, MessageCircle, MoreHorizontal, SmilePlus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import * as M from "@radix-ui/react-dropdown-menu";
import {
  addComment, comments as loadComments, deleteComment, deletePost, postOutcome, react, REACTIONS,
  type Comment, type FeedPost, type Reaction, type WorkoutSnapshot,
} from "@/lib/data/posts";
import { exerciseLine, shareVolumeKg, workingSetCount } from "@/lib/domain/post-summary";
import { formatDistance, formatPace, formatRunTime, paceSeconds, type DistanceUnit } from "@/lib/domain/running";
import { browserZone, inviteTimeLines } from "@/lib/domain/schedule";
import type { WeightUnit } from "@/lib/domain/types";
import { formatVolume } from "@/lib/domain/units";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar, Local, ReportSheet, type ReportSubject } from "./common";

function ago(iso: string) {
  const d = new Date(iso);
  if (Date.now() - d.getTime() < 60_000) return "now";
  return formatDistanceToNowStrict(d).replace(/ seconds?/, "s").replace(/ minutes?/, "m").replace(/ hours?/, "h").replace(/ days?/, "d").replace(/ months?/, "mo").replace(/ years?/, "y");
}

export function profileHref(id: string, me: string) {
  return id === me ? "/community/me" : `/community/u/${id}`;
}

const MAX_EXERCISES = 4;

/** Renders exactly what was stored in the snapshot; also used for the share preview. */
export function SnapshotView({ snap, unit, distUnit }: { snap: WorkoutSnapshot; unit: WeightUnit; distUnit: DistanceUnit }) {
  const [all, setAll] = useState(false);
  const sets = workingSetCount(snap.exercises);
  const vol = snap.include.loads && snap.include.reps ? shareVolumeKg(snap.exercises) : null;
  const stats = [
    snap.duration_min != null ? { k: "Time", v: `${snap.duration_min} min` } : null,
    snap.exercises.length > 0 ? { k: "Exercises", v: String(snap.exercises.length) } : null,
    sets > 0 ? { k: "Sets", v: String(sets) } : null,
    vol != null ? { k: "Volume", v: formatVolume(vol, unit) } : null,
    snap.runs.length > 0 && snap.runs.some((r) => r.distance_m) ? { k: "Distance", v: formatDistance(snap.runs.reduce((m, r) => m + (r.distance_m ?? 0), 0), distUnit) } : null,
  ].filter(Boolean) as { k: string; v: string }[];
  const shown = all ? snap.exercises : snap.exercises.slice(0, MAX_EXERCISES);
  return (
    <div className="overflow-hidden rounded-xl border bg-gradient-to-b from-accent-soft/70 to-transparent">
      <div className="px-4 pb-3 pt-3.5">
        <p className="text-[12px] font-medium text-muted-foreground"><Local>{() => new Date(snap.started_at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</Local>&nbsp;</p>
        <p className="text-[19px] font-bold leading-tight tracking-[-0.02em]">{snap.name}</p>
        {stats.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {stats.map((s) => (
              <div key={s.k}><dt className="text-[11.5px] font-medium text-muted-foreground">{s.k}</dt><dd className="num text-[17px] leading-tight">{s.v}</dd></div>
            ))}
          </dl>
        )}
      </div>
      {(snap.exercises.length > 0 || snap.runs.length > 0) && (
        <ul className="divide-y border-t bg-card/60">
          {shown.map((e, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2">
              <span className="min-w-0 truncate text-[14px] font-semibold">{e.name}</span>
              <span className="shrink-0 text-right text-[13px] tabular text-muted-foreground">{exerciseLine(e.sets, unit)}</span>
            </li>
          ))}
          {snap.exercises.length > MAX_EXERCISES && (
            <li><button onClick={() => setAll(!all)} className="h-10 w-full px-4 text-left text-[13px] font-semibold text-muted-foreground hover:text-foreground">
              {all ? "Show less" : `+${snap.exercises.length - MAX_EXERCISES} more`}
            </button></li>
          )}
          {snap.runs.map((r, i) => {
            const pace = formatPace(paceSeconds(r.duration_s, r.distance_m, distUnit), distUnit);
            return (
              <li key={`r${i}`} className="flex items-baseline justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate text-[14px] font-semibold">{r.name}</span>
                <span className="shrink-0 text-[13px] tabular text-muted-foreground">{[r.distance_m ? formatDistance(r.distance_m, distUnit) : null, r.duration_s ? formatRunTime(r.duration_s) : null, pace].filter(Boolean).join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AudienceTag({ audience }: { audience: "friends" | "gym" }) {
  return (
    <span className="inline-flex items-center gap-1" title={audience === "gym" ? "Shared with your gym community" : "Shared with friends"}>
      {audience === "gym" ? <MapPin className="size-3" /> : <Users className="size-3" />}
      {audience === "gym" ? "Gym" : "Friends"}
    </span>
  );
}

export function PostCard({ post, me, unit, distUnit, onRemoved }: { post: FeedPost; me: string; unit: WeightUnit; distUnit: DistanceUnit; onRemoved?: (id: string) => void }) {
  const router = useRouter();
  const [p, setP] = useState(post);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  const mine = p.author_id === me;
  const name = mine ? "You" : p.author_name;

  async function setReaction(emoji: Reaction | null) {
    const counts = { ...p.reactions };
    if (p.my_reaction) counts[p.my_reaction] = Math.max(0, (counts[p.my_reaction] ?? 1) - 1);
    if (emoji) counts[emoji] = (counts[emoji] ?? 0) + 1;
    const prev = p;
    setP({ ...p, my_reaction: emoji, reactions: counts });
    try { const r = await react(createClient(), p.id, emoji); if (r !== "reacted" && r !== "removed") { setP(prev); toast.error(postOutcome(r)); } }
    catch { setP(prev); toast.error("Couldn't react. Check your connection."); }
  }
  async function showComments() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    try { setList(await loadComments(createClient(), p.id)); } catch { setList([]); toast.error("Couldn't load comments."); }
  }
  async function submit() {
    const body = text.trim();
    if (!body) return;
    try {
      const r = await addComment(createClient(), crypto.randomUUID(), p.id, body);
      if (r !== "added") { toast.error(postOutcome(r)); return; }
      setText("");
      setList(await loadComments(createClient(), p.id));
      setP((x) => ({ ...x, comment_count: x.comment_count + 1 }));
    } catch { toast.error("Not sent. Check your connection and try again."); }
  }

  const reacted = Object.entries(p.reactions).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = reacted.reduce((n, [, c]) => n + c, 0);
  const iconBtn = "grid size-11 place-items-center rounded-full outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <article className="border-b pb-4 pt-1 last:border-b-0 md:rounded-xl md:border md:bg-card md:px-4 md:pt-4 md:shadow-card md:last:border-b">
      <header className="flex items-center gap-3">
        <Link href={profileHref(p.author_id, me)} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"><Avatar name={p.author_name} id={p.author_id} /></Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link href={profileHref(p.author_id, me)} className="block truncate text-[15px] font-bold tracking-tight hover:underline">{name}</Link>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <time dateTime={p.created_at}><Local>{() => ago(p.created_at)}</Local></time>
            <span aria-hidden>·</span>
            <AudienceTag audience={p.audience} />
          </p>
        </div>
        <Menu>
          <MenuTrigger className={cn(iconBtn, "-mr-2 text-muted-foreground")} aria-label="Post options"><MoreHorizontal className="size-5" /></MenuTrigger>
          <MenuContent>
            {mine ? (
              <MenuItem destructive onSelect={async () => {
                if (!confirm("Delete this post? Its reactions and comments go too. Your workout isn't affected.")) return;
                try { await deletePost(createClient(), p.id); toast.success("Post deleted"); onRemoved?.(p.id); router.refresh(); } catch (e) { toast.error((e as Error).message); }
              }}><Trash2 /> Delete post</MenuItem>
            ) : (
              <MenuItem onSelect={() => setReporting({ type: "post", id: p.id, user: p.author_id, label: "post" })}><Flag /> Report post</MenuItem>
            )}
          </MenuContent>
        </Menu>
      </header>

      <div className="mt-3">
        {p.kind === "workout" && p.snapshot && <SnapshotView snap={p.snapshot} unit={unit} distUnit={distUnit} />}
        {p.kind === "buddy" && p.starts_at && p.time_zone && (
          <div className="rounded-xl border bg-gradient-to-b from-accent-soft/70 to-transparent px-4 py-3.5">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-accent"><CalendarClock className="size-3.5" /> Looking for a gym buddy</p>
            <Local>{() => inviteTimeLines(new Date(p.starts_at!), p.time_zone!, browserZone()).map((l, i) => <p key={i} className={i === 0 ? "mt-1 text-[17px] font-bold tracking-tight" : "text-[12.5px] text-muted-foreground"}>{l}</p>)}</Local>
            {p.workout_name && <p className="mt-0.5 text-[14px] text-muted-foreground">{p.workout_name}</p>}
          </div>
        )}
      </div>

      <div className="-ml-2.5 mt-1 flex items-center">
        <button onClick={() => setReaction(p.my_reaction ? null : "❤️")} aria-pressed={!!p.my_reaction} aria-label={p.my_reaction ? `Remove your ${p.my_reaction} reaction` : "Like"} className={iconBtn}>
          {p.my_reaction && p.my_reaction !== "❤️" ? <span className="text-[21px] leading-none">{p.my_reaction}</span>
            : <Heart className={cn("size-[23px]", p.my_reaction && "fill-destructive text-destructive")} strokeWidth={1.9} />}
        </button>
        <button onClick={showComments} aria-expanded={open} aria-label="Comments" className={iconBtn}><MessageCircle className="size-[23px] -scale-x-100" strokeWidth={1.9} /></button>
        <M.Root>
          <M.Trigger className={iconBtn} aria-label="Choose a reaction"><SmilePlus className="size-[22px]" strokeWidth={1.9} /></M.Trigger>
          <M.Portal>
            <M.Content sideOffset={4} align="start" className="z-50 flex gap-0.5 rounded-full border bg-card p-1 shadow-raised data-[state=open]:animate-in">
              {REACTIONS.map((e) => (
                <M.Item key={e} onSelect={() => setReaction(p.my_reaction === e ? null : e)} aria-label={`React ${e}`}
                  className={cn("grid size-11 cursor-default place-items-center rounded-full text-[22px] outline-none data-[highlighted]:bg-muted", p.my_reaction === e && "bg-accent-soft")}>{e}</M.Item>
              ))}
            </M.Content>
          </M.Portal>
        </M.Root>
      </div>

      {total > 0 && (
        <p className="text-[13.5px]"><span aria-hidden className="mr-1">{reacted.slice(0, 3).map(([e]) => e).join("")}</span><span className="font-semibold tabular">{total}</span> <span className="sr-only">reactions</span></p>
      )}
      {p.caption && <p className="mt-1 whitespace-pre-wrap text-[14.5px] leading-snug"><Link href={profileHref(p.author_id, me)} className="mr-1.5 font-bold">{mine ? "You" : p.author_name}</Link>{p.caption}</p>}
      {p.comment_count > 0 && !open && (
        <button onClick={showComments} className="mt-1 text-[13.5px] text-muted-foreground hover:text-foreground">
          {p.comment_count === 1 ? "View 1 comment" : `View all ${p.comment_count} comments`}
        </button>
      )}

      {open && (
        <div className="mt-2 space-y-2">
          {list === null ? <p className="text-[13px] text-muted-foreground">Loading…</p> : list.map((c) => (
            <div key={c.id} className="group flex items-start gap-2.5">
              <Avatar name={c.author_name} id={c.author_id} className="mt-0.5 size-7 text-[10.5px]" />
              <p className="min-w-0 flex-1 text-[14px] leading-snug">
                <Link href={profileHref(c.author_id, me)} className="mr-1.5 font-bold">{c.author_id === me ? "You" : c.author_name}</Link>
                <span className="whitespace-pre-wrap break-words">{c.body}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground"><Local>{() => ago(c.created_at)}</Local></span>
              </p>
              <Menu>
                <MenuTrigger className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Comment options"><MoreHorizontal className="size-4" /></MenuTrigger>
                <MenuContent>
                  {c.can_delete && <MenuItem destructive onSelect={async () => {
                    try { await deleteComment(createClient(), c.id); setList((l) => (l ?? []).filter((x) => x.id !== c.id)); setP((x) => ({ ...x, comment_count: Math.max(0, x.comment_count - 1) })); }
                    catch (e) { toast.error((e as Error).message); }
                  }}><Trash2 /> {c.author_id === me ? "Delete comment" : "Remove comment"}</MenuItem>}
                  {c.author_id !== me && <MenuItem onSelect={() => setReporting({ type: "comment", id: c.id, user: c.author_id, label: "comment" })}><Flag /> Report comment</MenuItem>}
                </MenuContent>
              </Menu>
            </div>
          ))}
          <form className="flex items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Add a comment…" aria-label="Add a comment"
              className="h-11 min-w-0 flex-1 rounded-full border bg-background px-4 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <button type="submit" disabled={!text.trim()} className="h-11 px-2 text-[14px] font-bold text-accent disabled:opacity-40">Post</button>
          </form>
        </div>
      )}

      <ReportSheet subject={reporting} onClose={() => setReporting(null)} onReported={() => {
        if (reporting?.type === "post") onRemoved?.(p.id);
        if (reporting?.type === "comment") setList((l) => (l ?? []).filter((x) => x.id !== reporting.id));
      }} />
    </article>
  );
}

export function FeedList({ posts, me, unit, distUnit, empty }: { posts: FeedPost[]; me: string; unit: WeightUnit; distUnit: DistanceUnit; empty: React.ReactNode }) {
  const [list, setList] = useState(posts);
  if (list.length === 0) return <>{empty}</>;
  return <div className="space-y-4 md:space-y-5">{list.map((p) => <PostCard key={p.id} post={p} me={me} unit={unit} distUnit={distUnit} onRemoved={(id) => setList((l) => l.filter((x) => x.id !== id))} />)}</div>;
}
