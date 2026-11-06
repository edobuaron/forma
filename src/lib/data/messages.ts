// Private messages and training invitations (migration 020). Reads are limited by RLS to the two
// participants; writes go through functions that check friendship, blocks, restrictions and limits.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InviteStatus } from "@/lib/domain/schedule";

type DB = SupabaseClient;

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export type CanSend = "ok" | "not_friends" | "unavailable" | "restricted";
export type ConversationSummary = {
  conversation_id: string; other_id: string; display_name: string; last_message_at: string;
  last_kind: "text" | "invite" | "invite_event" | null; last_body: string | null; last_from_me: boolean;
  unread: number; muted: boolean; can_send: CanSend;
};
export type ConversationInfo = { other_id: string; display_name: string; can_send: CanSend; muted: boolean };
export type Message = {
  id: string; conversation_id: string; sender_id: string; kind: "text" | "invite" | "invite_event";
  body: string | null; invite_id: string | null; created_at: string;
};
export type TrainingInvite = {
  id: string; conversation_id: string; from_id: string; to_id: string; gym_id: string | null; gym_name: string;
  starts_at: string; time_zone: string; workout_name: string | null; note: string | null; status: InviteStatus;
  proposed_by: string; awaiting_id: string | null; version: number; updated_at: string;
};

export async function myConversations(db: DB): Promise<ConversationSummary[]> {
  return ok(await db.rpc("my_conversations")) as ConversationSummary[];
}
export async function unreadTotal(db: DB): Promise<number> {
  const r = await db.rpc("unread_message_total");
  return r.error ? 0 : (r.data as number) ?? 0;
}
export async function conversationInfo(db: DB, id: string): Promise<ConversationInfo | null> {
  return ok(await db.rpc("conversation_info", { p_conversation: id })) as ConversationInfo | null;
}
export async function openConversation(db: DB, other: string): Promise<string> {
  const r = await db.rpc("open_conversation", { p_other: other });
  if (r.error?.message === "cannot_message") throw new Error("You can message only friends.");
  return ok(r) as string;
}
export async function loadMessages(db: DB, conversationId: string, limit = 200): Promise<Message[]> {
  const rows = ok(await db.from("messages").select("id, conversation_id, sender_id, kind, body, invite_id, created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(limit)) as Message[];
  return rows.reverse();
}
export async function loadInvites(db: DB, conversationId: string): Promise<TrainingInvite[]> {
  return ok(await db.from("training_invites").select("*").eq("conversation_id", conversationId)) as TrainingInvite[];
}
export async function sendMessage(db: DB, id: string, to: string, body: string): Promise<{ status: string; created_at?: string }> {
  return ok(await db.rpc("send_message", { p_id: id, p_to: to, p_body: body })) as { status: string; created_at?: string };
}
export async function markRead(db: DB, conversationId: string): Promise<void> {
  await db.rpc("mark_conversation_read", { p_conversation: conversationId });
}
export async function setMuted(db: DB, conversationId: string, muted: boolean): Promise<void> {
  ok(await db.rpc("set_conversation_muted", { p_conversation: conversationId, p_muted: muted }));
}
export async function createTrainingInvite(db: DB, p: {
  id: string; to: string; gymId: string | null; gymName: string; startsAt: Date; timeZone: string; workout?: string; note?: string;
}): Promise<string> {
  const r = ok(await db.rpc("create_training_invite", {
    p_id: p.id, p_to: p.to, p_gym_id: p.gymId, p_gym_name: p.gymName, p_starts_at: p.startsAt.toISOString(),
    p_time_zone: p.timeZone, p_workout_name: p.workout || null, p_note: p.note || null,
  })) as { status: string };
  return r.status;
}
export async function respondTrainingInvite(db: DB, id: string, action: "accept" | "decline" | "propose" | "cancel", version: number, next?: { startsAt: Date; timeZone: string }): Promise<string> {
  return ok(await db.rpc("respond_training_invite", {
    p_id: id, p_action: action, p_version: version, p_starts_at: next?.startsAt.toISOString() ?? null, p_time_zone: next?.timeZone ?? null,
  })) as string;
}

export type UpcomingSession = {
  id: string; conversation_id: string; other_id: string; display_name: string; gym_name: string; starts_at: string;
  time_zone: string; workout_name: string | null; status: "accepted" | "pending"; awaiting_me: boolean; version: number;
};
/** Accepted sessions (and invitations waiting for the caller's answer) in the coming weeks. */
export async function upcomingSessions(db: DB): Promise<UpcomingSession[]> {
  const r = await db.rpc("my_upcoming_sessions");
  return r.error ? [] : ((r.data ?? []) as UpcomingSession[]);
}
