"use client";
import { formatDistanceToNowStrict } from "date-fns";
import { CalendarClock, ChevronDown, CopyPlus, Flag, Heart, MapPin, MessageCircle, MoreHorizontal, SmilePlus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import * as M from "@radix-ui/react-dropdown-menu";
import {
  addComment, comments as loadComments, deleteComment, deletePost, isSaveable, postOutcome, react, REACTIONS,
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

const PREVIEW_EXERCISES = 3;

/**
 * Renders exactly what was stored in the snapshot (also the share preview). Compact by default: the
 * first few exercises, expandable on demand. Only fields the author shared exist in the snapshot.
 */
export function SnapshotView({ snap, unit, distUnit, expanded = false }: { snap: WorkoutSnapshot; unit: WeightUnit; distUnit: DistanceUnit; expanded?: boolean }) {
  const [all, setAll] = useState(expanded);
  const sets = workingSetCount(snap.exercises);
  const vol = snap.include.loads && snap.include.reps ? shareVolumeKg(snap.exercises) : null;
  const stats = [
    snap.duration_min != null ? { k: "Time", v: `${snap.duration_min} min` } : null,
    snap.exercises.length > 0 ? { k: "Exercises", v: String(snap.exercises.length) } : null,
    sets > 0 ? { k: "Sets", v: String(sets) } : null,
    vol != null ? { k: "Volume", v: formatVolume(vol, unit) } : null,
    snap.runs.length > 0 && snap.runs.some((r) => r.distance_m) ? { k: "Distance", v: formatDistance(snap.runs.reduce((m, r) => m + (r.distance_m ?? 0), 0), distUnit) } : null,
  ].filter(Boolean) as { k: string; v: string }[];
  const hidden = snap.exercises.length - PREVIEW_EXERCISES;
  const shown = all || hidden <= 1 ? snap.exercises : snap.exercises.slice(0, PREVIEW_EXERCISES);
  return (
    <div className="overflow-hidden rounded-xl border bg-subtle/45">
      <div className="px-4 pb-3 pt-3">
        <p className="text-[17px] font-bold leading-tight tracking-[-0.02em]">{snap.name}</p>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground"><Local>{() => new Date(snap.started_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</Local>&nbsp;</p>
        {stats.length > 0 && (
          <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
            {stats.map((s) => (
              <div key={s.k}><dt className="text-[11px] font-medium text-muted-foreground">{s.k}</dt><dd className="num text-[16px] leading-tight">{s.v}</dd></div>
            ))}
          </dl>
        )}
      </div>
      {(snap.exercises.length > 0 || snap.runs.length > 0) && (
        <ul className="border-t bg-card/70 py-1">
          {shown.map((e, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-1.5">
              <span className="min-w-0 truncate text-[14px] font-medium">{e.name}</span>
              <span className="shrink-0 text-right text-[13px] tabular text-muted-foreground">{exerciseLine(e.sets, unit)}</span>
            </li>
          ))}
          {hidden > 1 && (
            <li><button type="button" onClick={() => setAll(!all)} aria-expanded={all}
              className="flex h-9 w-full items-center gap-1 px-4 text-left text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
              {all ? "Show less" : `Show all ${snap.exercises.length} exercises`}
              <ChevronDown className={cn("size-3.5 transition-transform", all && "rotate-180")} />
            </button></li>
          )}
          {snap.runs.map((r, i) => {
            const pace = formatPace(paceSeconds(r.duration_s, r.distance_m, distUnit), distUnit);
            return (
              <li key={`r${i}`} className="flex items-baseline justify-between gap-3 px-4 py-1.5">
                <span className="min-w-0 truncate text-[14px] font-medium">{r.name}</span>
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

export function PostCard({ post, me, unit, distUnit, onRemoved, initialComments }: {
  post: FeedPost; me: string; unit: WeightUnit; distUnit: DistanceUnit; onRemoved?: (id: string) => void;
  /** Fixture previews only: show these comments open. */
  initialComments?: Comment[];
}) {
  const router = useRouter();
  const [p, setP] = useState(post);
  const [open, setOpen] = useState(!!initialComments);
  const [list, setList] = useState<Comment[] | null>(initialComments ?? null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [reporting, setReporting] = useState<ReportSubject | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mine = p.author_id === me;
  const name = mine ? "You" : p.author_name;
  const saveable = !mine && isSaveable(p);

  async function setReaction(emoji: Reaction | null) {
    const counts = { ...p.reactions };
    if (p.my_reaction) counts[p.my_reaction] = Math.max(0, (counts[p.my_reaction] ?? 1) - 1);
    if (emoji) counts[emoji] = (counts[emoji] ?? 0) + 1;
    const prev = p;
    setP({ ...p, my_reaction: emoji, reactions: counts });
    try { const r = await react(createClient(), p.id, emoji); if (r !== "reacted" && r !== "removed") { setP(prev); toast.error(postOutcome(r)); } }
    catch { setP(prev); toast.error("Couldn't react. Check your connection."); }
  }
  async function openComments(focus = false) {
    if (!open) {
      setOpen(true);
      if (list === null) {
        try { setList(await loadComments(createClient(), p.id)); } catch { setList([]); toast.error("Couldn't load comments."); }
      }
    }
    if (focus) requestAnimationFrame(() => input.current?.focus());
  }
  function reply(c: Comment) {
    const handle = `@${(c.author_id === me ? "" : c.author_name.split(" ")[0])} `;
    setText((t) => (t.startsWith(handle) || c.author_id === me ? t : handle + t));
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(input.current.value.length, input.current.value.length); });
  }
  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await addComment(createClient(), crypto.randomUUID(), p.id, body);
      if (r !== "added") { toast.error(postOutcome(r)); return; }
      setText("");
      setList(await loadComments(createClient(), p.id));
      setP((x) => ({ ...x, comment_count: x.comment_count + 1 }));
    } catch { toast.error("Not sent. Check your connection and try again."); } finally { setSending(false); }
  }

  const reacted = Object.entries(p.reactions).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = reacted.reduce((n, [, c]) => n + c, 0);
  const iconBtn = "grid size-11 place-items-center rounded-full outline-none transition-[background-color,transform] hover:bg-muted active:scale-90 focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <article className="border-b pb-3 pt-1 last:border-b-0 md:rounded-xl md:border md:bg-card md:px-4 md:pt-4 md:shadow-card md:last:border-b">
      <header className="flex items-center gap-3">
        <Link href={profileHref(p.author_id, me)} className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"><Avatar name={p.author_name} id={p.author_id} /></Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link href={profileHref(p.author_id, me)} className="block truncate text-[15px] font-semibold tracking-tight hover:underline">{name}</Link>
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
                if (!confirm(isSaveable(p)
                  ? "Delete this post? Its reactions and comments go too. Copies friends already saved stay theirs. Your workout isn't affected."
                  : "Delete this post? Its reactions and comments go too. Your workout isn't affected.")) return;
                try { await deletePost(createClient(), p.id); toast.success("Post deleted"); onRemoved?.(p.id); router.refresh(); } catch (e) { toast.error((e as Error).message); }
              }}><Trash2 /> Delete post</MenuItem>
            ) : (
              <MenuItem onSelect={() => setReporting({ type: "post", id: p.id, user: p.author_id, label: "post" })}><Flag /> Report post</MenuItem>
            )}
          </MenuContent>
        </Menu>
      </header>

      {p.caption && <p className="mt-2.5 whitespace-pre-wrap break-words text-[15px] leading-snug">{p.caption}</p>}

      <div className="mt-2.5">
        {p.kind === "workout" && p.snapshot && <SnapshotView snap={p.snapshot} unit={unit} distUnit={distUnit} />}
        {p.kind === "buddy" && p.starts_at && p.time_zone && (
          <div className="rounded-xl border bg-subtle/45 px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-accent"><CalendarClock className="size-3.5" /> Looking for a training partner</p>
            <Local>{() => inviteTimeLines(new Date(p.starts_at!), p.time_zone!, browserZone()).map((l, i) => <p key={i} className={i === 0 ? "mt-1 text-[16px] font-semibold tracking-tight" : "text-[12.5px] text-muted-foreground"}>{l}</p>)}</Local>
            {p.workout_name && <p className="mt-0.5 text-[14px] text-muted-foreground">{p.workout_name}</p>}
          </div>
        )}
      </div>

      <div className="-ml-2.5 mt-1 flex items-center">
        <button type="button" onClick={() => setReaction(p.my_reaction ? null : "❤️")} aria-pressed={!!p.my_reaction} aria-label={p.my_reaction ? `Remove your ${p.my_reaction} reaction` : "Like"} className={iconBtn}>
          {p.my_reaction && p.my_reaction !== "❤️" ? <span className="text-[21px] leading-none">{p.my_reaction}</span>
            : <Heart className={cn("size-[23px] transition-colors", p.my_reaction && "fill-destructive text-destructive")} strokeWidth={1.9} />}
        </button>
        <button type="button" onClick={() => (open ? setOpen(false) : openComments(true))} aria-expanded={open} aria-label="Comment" className={iconBtn}><MessageCircle className="size-[23px] -scale-x-100" strokeWidth={1.9} /></button>
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
        {saveable && (
          <Link href={`/community/p/${p.id}/save`} className="-mr-1 ml-auto inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold text-foreground outline-none transition-colors hover:bg-muted active:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <CopyPlus className="size-[18px]" strokeWidth={1.9} /> Save to my programs
          </Link>
        )}
      </div>

      {(total > 0 || p.comment_count > 0) && (
        <p className="flex items-center gap-2 text-[13.5px]">
          {total > 0 && <span><span aria-hidden className="mr-1">{reacted.slice(0, 3).map(([e]) => e).join("")}</span><span className="font-semibold tabular">{total}</span><span className="sr-only"> reactions</span></span>}
          {total > 0 && p.comment_count > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
          {p.comment_count > 0 && !open && (
            <button type="button" onClick={() => openComments()} className="text-muted-foreground transition-colors hover:text-foreground">
              {p.comment_count === 1 ? "1 comment" : `${p.comment_count} comments`}
            </button>
          )}
          {p.comment_count > 0 && open && <span className="text-muted-foreground">{p.comment_count === 1 ? "1 comment" : `${p.comment_count} comments`}</span>}
        </p>
      )}

      {open && (
        <div className="mt-2 space-y-2.5">
          {list === null ? <p className="text-[13px] text-muted-foreground">Loading…</p> : list.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5">
              <Link href={profileHref(c.author_id, me)} className="mt-0.5 shrink-0 rounded-full"><Avatar name={c.author_name} id={c.author_id} className="size-7 text-[10.5px]" /></Link>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-snug">
                  <Link href={profileHref(c.author_id, me)} className="mr-1.5 font-semibold">{c.author_id === me ? "You" : c.author_name}</Link>
                  <span className="whitespace-pre-wrap break-words">{c.body}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-3 text-[12px] text-muted-foreground">
                  <Local>{() => ago(c.created_at)}</Local>
                  {c.author_id !== me && <button type="button" onClick={() => reply(c)} className="font-semibold hover:text-foreground">Reply</button>}
                </p>
              </div>
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
          <form className="flex items-center gap-2 pt-0.5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Add a comment…" aria-label="Add a comment" enterKeyHint="send"
              className="h-11 min-w-0 flex-1 rounded-full border bg-background px-4 text-[14px] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring" />
            <button type="submit" disabled={!text.trim() || sending} className="h-11 rounded-full px-3 text-[14px] font-semibold text-accent transition-opacity hover:bg-accent-soft disabled:opacity-40">{sending ? "Posting…" : "Post"}</button>
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

/**
 * Remembers the scroll position when the viewer opens a profile, post or conversation from this list,
 * and restores it when they come back, so returning never drops them at the top.
 */
export function useScrollMemory(key: string) {
  useEffect(() => {
    const k = `forma.scroll.${key}`;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(k); sessionStorage.removeItem(k); } catch { /* storage unavailable */ }
    if (saved) {
      const y = Number(saved);
      // Twice: once now, once after images and late content settle.
      requestAnimationFrame(() => window.scrollTo(0, y));
      const t = setTimeout(() => window.scrollTo(0, y), 250);
      return () => clearTimeout(t);
    }
  }, [key]);
  useEffect(() => {
    const k = `forma.scroll.${key}`;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      const href = a?.getAttribute("href") ?? "";
      if (href.startsWith("/community/u/") || href.startsWith("/community/p/") || href.startsWith("/community/me") || href.startsWith("/community/messages/")) {
        try { sessionStorage.setItem(k, String(window.scrollY)); } catch { /* storage unavailable */ }
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [key]);
}

export function FeedList({ posts, me, unit, distUnit, empty, scrollKey, loadMore, previewComments }: {
  posts: FeedPost[]; me: string; unit: WeightUnit; distUnit: DistanceUnit; empty: React.ReactNode;
  /** Fixture previews only. */
  previewComments?: Record<string, Comment[]>;
  /** Restore the scroll position under this key when returning to the list. */
  scrollKey?: string;
  /** Older posts before a timestamp; shown as a "Show older posts" button while pages are full. */
  loadMore?: (before: string) => Promise<FeedPost[]>;
}) {
  const [list, setList] = useState(posts);
  const [more, setMore] = useState(!!loadMore && posts.length >= 30);
  const [busy, setBusy] = useState(false);
  useScrollMemory(scrollKey ?? "none");
  if (list.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-4 md:space-y-5">
      {list.map((p) => <PostCard key={p.id} post={p} me={me} unit={unit} distUnit={distUnit} initialComments={previewComments?.[p.id]} onRemoved={(id) => setList((l) => l.filter((x) => x.id !== id))} />)}
      {more && loadMore && (
        <button type="button" disabled={busy} className="h-11 w-full rounded-full text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            try {
              const older = await loadMore(list[list.length - 1].created_at);
              const seen = new Set(list.map((x) => x.id));
              setList((l) => [...l, ...older.filter((x) => !seen.has(x.id))]);
              if (older.length < 30) setMore(false);
            } catch { toast.error("Couldn't load older posts."); } finally { setBusy(false); }
          }}>{busy ? "Loading…" : "Show older posts"}</button>
      )}
    </div>
  );
}
