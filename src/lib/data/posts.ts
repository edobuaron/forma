// Community posts (migration 021). Viewers read posts, reactions and comments only, never the
// workout records behind them; the server builds every snapshot.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { PlanItem } from "@/lib/domain/shared-copy";

type DB = SupabaseClient;

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const REACTIONS = ["❤️", "💪", "🔥", "👏", "🏋️", "😮"] as const;
export type Reaction = (typeof REACTIONS)[number];
export type Audience = "friends" | "gym";
export type ShareInclude = { loads: boolean; reps: boolean; duration: boolean; runs: boolean; plan?: boolean };

export type SnapshotSet = { kg?: number; assist_kg?: number; reps?: number; left?: SnapshotSide; right?: SnapshotSide };
export type SnapshotSide = { kg?: number; assist_kg?: number; reps?: number };
export type WorkoutSnapshot = {
  name: string; started_at: string; duration_min?: number;
  exercises: { name: string; convention?: string; sets: SnapshotSet[] }[];
  runs: { name: string; duration_s?: number; distance_m?: number }[];
  /** The prescription the workout started from, only when the author chose to let friends save it. */
  plan?: PlanItem[];
  include: ShareInclude;
};

export type FeedPost = {
  id: string; author_id: string; author_name: string; kind: "workout" | "buddy"; audience: Audience; gym_id: string | null;
  caption: string | null; snapshot: WorkoutSnapshot | null; starts_at: string | null; time_zone: string | null; workout_name: string | null;
  created_at: string; reactions: Record<string, number>; my_reaction: string | null; comment_count: number;
};
export type Comment = { id: string; author_id: string; author_name: string; body: string; created_at: string; can_delete: boolean };

export async function feed(db: DB, scope: "friends" | "gym" | "buddy" | "mine", before?: string): Promise<FeedPost[]> {
  return ok(await db.rpc("community_feed", { p_scope: scope, p_limit: 30, p_before: before ?? null })) as FeedPost[];
}
/** Posts by one person that the caller may see (friends posts, and gym posts at the caller's gym). */
export async function profilePosts(db: DB, authorId: string, before?: string): Promise<FeedPost[]> {
  return ok(await db.rpc("profile_posts", { p_author: authorId, p_limit: 30, p_before: before ?? null })) as FeedPost[];
}

/** A post's snapshot can be saved when the author shared its plan. */
export function isSaveable(p: Pick<FeedPost, "kind" | "snapshot">): boolean {
  return p.kind === "workout" && !!p.snapshot?.include?.plan && Array.isArray(p.snapshot.plan) && p.snapshot.plan.length > 0;
}

export type SaveResult = { status: "saved" | "already_saved"; program_id: string; template_id: string } | { status: "error"; code: string };

/** Atomic and idempotent by requestId: a retry returns the copy already made. */
export async function saveSharedWorkout(db: DB, requestId: string, postId: string, payload: unknown): Promise<SaveResult> {
  const r = await db.rpc("save_shared_workout", { p_id: requestId, p_post: postId, p_payload: payload });
  if (r.error) return { status: "error", code: r.error.message };
  const d = r.data as { status: string; program_id?: string; template_id?: string };
  if (d.status === "saved" || d.status === "already_saved") return { status: d.status, program_id: d.program_id!, template_id: d.template_id! };
  return { status: "error", code: d.status };
}

/** The caller's earlier saves of this post (their own records only). */
export async function mySavesOf(db: DB, postId: string): Promise<{ id: string; program_id: string | null; template_id: string | null; created_at: string }[]> {
  return ok(await db.from("workout_copies").select("id, program_id, template_id, created_at").eq("post_id", postId).not("template_id", "is", null).order("created_at", { ascending: false })) as { id: string; program_id: string | null; template_id: string | null; created_at: string }[];
}

export async function previewShare(db: DB, sessionId: string, include: ShareInclude): Promise<WorkoutSnapshot | null> {
  return ok(await db.rpc("preview_workout_share", { p_session: sessionId, p_include: include })) as WorkoutSnapshot | null;
}
export async function shareWorkout(db: DB, p: { id: string; sessionId: string; audience: Audience; include: ShareInclude; caption: string }): Promise<string> {
  return ok(await db.rpc("share_workout", { p_id: p.id, p_session: p.sessionId, p_audience: p.audience, p_include: p.include, p_caption: p.caption || null })) as string;
}
export async function postBuddy(db: DB, p: { id: string; audience: Audience; startsAt: Date; timeZone: string; workout: string; caption: string }): Promise<string> {
  return ok(await db.rpc("post_buddy_invite", {
    p_id: p.id, p_audience: p.audience, p_starts_at: p.startsAt.toISOString(), p_time_zone: p.timeZone, p_workout_name: p.workout || null, p_caption: p.caption || null,
  })) as string;
}
export async function deletePost(db: DB, id: string): Promise<void> {
  ok(await db.from("posts").delete().eq("id", id));
}
export async function react(db: DB, postId: string, emoji: Reaction | null): Promise<string> {
  return ok(await db.rpc("react_to_post", { p_post: postId, p_emoji: emoji })) as string;
}
export async function comments(db: DB, postId: string): Promise<Comment[]> {
  return ok(await db.rpc("post_comments_with_names", { p_post: postId })) as Comment[];
}
export async function addComment(db: DB, id: string, postId: string, body: string): Promise<string> {
  return ok(await db.rpc("add_comment", { p_id: id, p_post: postId, p_body: body })) as string;
}
export async function deleteComment(db: DB, id: string): Promise<void> {
  ok(await db.from("post_comments").delete().eq("id", id));
}
export async function gymActivity(db: DB, gymId: string): Promise<{ posts_7d: number; buddy_upcoming: number }> {
  return ok(await db.rpc("gym_activity", { p_gym: gymId })) as { posts_7d: number; buddy_upcoming: number };
}

const POST_COPY: Record<string, string> = {
  shared: "Posted.",
  already_shared: "You already shared this workout with that audience.",
  no_gym: "Choose your gym first to post to a gym community.",
  restricted: "Your account can't post while reports about it are reviewed.",
  rate_limited: "You've posted a lot today. Try again tomorrow.",
  not_found: "This isn't available any more.",
  invalid_time_zone: "Pick a valid time zone.",
  invalid_time: "Pick a time in the next 60 days.",
  invalid: "This can't be posted.",
  added: "Comment added.",
};
export function postOutcome(s: string): string {
  return POST_COPY[s] ?? "Something went wrong. Please try again.";
}
