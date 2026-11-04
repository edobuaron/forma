"use client";
import { CalendarClock, Flag, MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import {
  addComment, comments as loadComments, deleteComment, deletePost, postOutcome, react, REACTIONS,
  type Comment, type FeedPost, type Reaction, type SnapshotSet, type WorkoutSnapshot,
} from "@/lib/data/posts";
import type { WeightUnit } from "@/lib/domain/types";
import { formatDistance, formatPace, formatRunTime, paceSeconds, type DistanceUnit } from "@/lib/domain/running";
import { browserZone, inviteTimeLines } from "@/lib/domain/schedule";
import { formatWeight } from "@/lib/domain/units";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Avatar, ReportSheet, type ReportSubject } from "./common";

function uuid() { return crypto.randomUUID(); }

function setText(s: SnapshotSet, unit: WeightUnit): string {
  const one = (x: { kg?: number; assist_kg?: number; reps?: number }) => {
    const load = x.assist_kg != null ? `−${formatWeight(x.assist_kg, unit)}` : x.kg != null ? formatWeight(x.kg, unit) : null;
    return [load, x.reps != null ? `${x.reps}` : null].filter(Boolean).join(" × ");
  };
  if (s.left || s.right) return [s.left ? `L ${one(s.left) || "✓"}` : null, s.right ? `R ${one(s.right) || "✓"}` : null].filter(Boolean).join(" · ");
  return one(s) || "✓";
}

/** Renders exactly what was stored in the snapshot; used for the share preview too. */
export function SnapshotView({ snap, unit, distUnit }: { snap: WorkoutSnapshot; unit: WeightUnit; distUnit: DistanceUnit }) {
  const sets = snap.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <div>
      <p className="text-[16px] font-semibold tracking-tight">{snap.name}</p>
      <p className="text-[12.5px] text-muted-foreground">
        {new Date(snap.started_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
        {snap.duration_min != null && ` · ${snap.duration_min} min`}
        {sets > 0 && ` · ${sets} working ${sets === 1 ? "set" : "sets"}`}
      </p>
      {snap.exercises.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {snap.exercises.map((e, i) => (
            <li key={i} className="text-[13.5px]">
              <span className="font-semibold">{e.name}</span>
              <span className="text-muted-foreground"> · {e.sets.length} {e.sets.length === 1 ? "set" : "sets"}</span>
              {(snap.include.loads || snap.include.reps) && e.sets.length > 0 && (
                <span className="block text-[12.5px] tabular text-muted-foreground">{e.sets.map((s) => setText(s, unit)).join(", ")}{snap.include.loads && e.convention && e.convention !== "total" ? ` (${e.convention.replace("_", " ")})` : ""}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {snap.runs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {snap.runs.map((r, i) => {
            const pace = formatPace(paceSeconds(r.duration_s, r.distance_m, distUnit), distUnit);
            return <li key={i} className="text-[13.5px]"><span className="font-semibold">{r.name}</span> <span className="text-muted-foreground">{[r.distance_m ? formatDistance(r.distance_m, distUnit) : null, r.duration_s ? formatRunTime(r.duration_s) : null, pace].filter(Boolean).join(" · ")}</span></li>;
          })}
        </ul>
      )}
    </div>
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

  async function toggle(emoji: Reaction) {
    const next = p.my_reaction === emoji ? null : emoji;
    const counts = { ...p.reactions };
    if (p.my_reaction) counts[p.my_reaction] = Math.max(0, (counts[p.my_reaction] ?? 1) - 1);
    if (next) counts[next] = (counts[next] ?? 0) + 1;
    const prev = p;
    setP({ ...p, my_reaction: next, reactions: counts });
    try { const r = await react(createClient(), p.id, next); if (r !== "reacted" && r !== "removed") { setP(prev); toast.error(postOutcome(r)); } }
    catch (e) { setP(prev); toast.error((e as Error).message); }
  }
  async function openComments() {
    setOpen(!open);
    if (!open) { try { setList(await loadComments(createClient(), p.id)); } catch (e) { toast.error((e as Error).message); } }
  }
  async function submit() {
    const body = text.trim();
    if (!body) return;
    const id = uuid();
    try {
      const r = await addComment(createClient(), id, p.id, body);
      if (r !== "added") { toast.error(postOutcome(r)); return; }
      setText("");
      setList(await loadComments(createClient(), p.id));
      setP((x) => ({ ...x, comment_count: x.comment_count + 1 }));
    } catch { toast.error("Not sent. Check your connection and try again."); }
  }

  return (
    <article className="rounded-lg border bg-card p-4 shadow-card">
      <header className="flex items-start gap-3">
        <Avatar name={p.author_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{mine ? "You" : p.author_name}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
            <time dateTime={p.created_at}>{new Date(p.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
            <Badge tone="outline">{p.audience === "gym" ? "Gym community" : "Friends"}</Badge>
          </p>
        </div>
        <Menu>
          <MenuTrigger className="grid size-10 place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Post options"><MoreHorizontal className="size-5" /></MenuTrigger>
          <MenuContent>
            {mine ? (
              <MenuItem destructive onSelect={async () => {
                if (!confirm("Delete this post? Its reactions and comments are deleted too. Your workout isn't affected.")) return;
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
          <div className="rounded-md bg-accent-soft p-3">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-accent"><CalendarClock className="size-4" /> Looking for a gym buddy</p>
            {inviteTimeLines(new Date(p.starts_at), p.time_zone, browserZone()).map((l, i) => <p key={i} className={i === 0 ? "mt-1 text-[14px]" : "text-[12.5px] text-muted-foreground"}>{l}</p>)}
            {p.workout_name && <p className="text-[13px] text-muted-foreground">Workout: {p.workout_name}</p>}
          </div>
        )}
        {p.caption && <p className="mt-2.5 whitespace-pre-wrap text-[14px]">{p.caption}</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
        {REACTIONS.map((e) => (
          <button key={e} onClick={() => toggle(e)} aria-pressed={p.my_reaction === e} aria-label={`React ${e}${p.reactions[e] ? `, ${p.reactions[e]}` : ""}`}
            className={cn("flex h-10 min-w-10 items-center justify-center gap-1 rounded-full border px-2.5 text-[15px] transition-colors hover:bg-muted", p.my_reaction === e && "border-accent bg-accent-soft")}>
            <span aria-hidden>{e}</span>{p.reactions[e] ? <span className="text-[12px] font-semibold tabular">{p.reactions[e]}</span> : null}
          </button>
        ))}
        <Button variant="quiet" size="sm" className="ml-auto h-10" onClick={openComments} aria-expanded={open}>
          <MessageSquare /> {p.comment_count > 0 ? p.comment_count : ""} {p.comment_count === 1 ? "comment" : "comments"}
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-2.5">
          {list === null ? <p className="text-[13px] text-muted-foreground">Loading…</p> : list.length === 0 ? <p className="text-[13px] text-muted-foreground">No comments yet.</p> : list.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <Avatar name={c.author_name} className="size-8 text-[11px]" />
              <div className="min-w-0 flex-1 rounded-md bg-subtle px-3 py-2">
                <p className="text-[12.5px] font-semibold">{c.author_id === me ? "You" : c.author_name}</p>
                <p className="whitespace-pre-wrap break-words text-[14px]">{c.body}</p>
              </div>
              <Menu>
                <MenuTrigger className="grid size-9 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label="Comment options"><MoreHorizontal className="size-4" /></MenuTrigger>
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
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Add a comment" aria-label="Add a comment" />
            <Button type="submit" variant="primary" disabled={!text.trim()}>Post</Button>
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
  return <div className="space-y-4">{list.map((p) => <PostCard key={p.id} post={p} me={me} unit={unit} distUnit={distUnit} onRemoved={(id) => setList((l) => l.filter((x) => x.id !== id))} />)}</div>;
}

