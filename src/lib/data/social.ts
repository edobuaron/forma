// Community data access (migration 019+). Every call goes through RLS or a security-definer function
// that checks the caller; nothing here can read another user's private records.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Gym, GymDraft, Relation, ReportReason, SocialProfile } from "@/lib/domain/social";

type DB = SupabaseClient;

function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export type Membership = { gym_id: string; discoverable: boolean; joined_at: string };
export type Person = { user_id: string; display_name: string; relation: Relation };
export type Friend = { user_id: string; display_name: string; since: string };
export type FriendRequest = { id: string; direction: "incoming" | "outgoing"; other_id: string; display_name: string; created_at: string };
export type Blocked = { user_id: string; display_name: string; blocked_at: string };
export type GymCounts = { visible_members: number; friends_here: number };

const GYM_COLS = "id, name, chain, address, city, country, verified";

export async function getMyGym(db: DB): Promise<{ membership: Membership | null; gym: Gym | null }> {
  const m = ok(await db.from("gym_memberships").select("gym_id, discoverable, joined_at").maybeSingle()) as Membership | null;
  if (!m) return { membership: null, gym: null };
  const gym = ok(await db.from("gyms").select(GYM_COLS).eq("id", m.gym_id).maybeSingle()) as Gym | null;
  return { membership: m, gym };
}

export async function searchGyms(db: DB, q: string): Promise<Gym[]> {
  const term = q.trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (term.length < 2) return [];
  const like = `%${term}%`;
  return ok(await db.from("gyms").select(GYM_COLS).or(`name.ilike.${like},city.ilike.${like},address.ilike.${like},chain.ilike.${like}`).order("name").limit(20)) as Gym[];
}

export async function gymsInCity(db: DB, city: string): Promise<Gym[]> {
  if (!city.trim()) return [];
  return ok(await db.from("gyms").select(GYM_COLS).ilike("city", city.trim().replace(/[%_]/g, "")).limit(100)) as Gym[];
}

export async function addGym(db: DB, d: GymDraft): Promise<{ id: string; created: boolean }> {
  const r = ok(await db.rpc("add_gym", { p_name: d.name, p_chain: d.chain || null, p_address: d.address, p_city: d.city, p_country: d.country })) as { id?: string; created?: boolean; error?: string };
  if (r.error === "rate_limited") throw new Error("You've added several gyms today. Try again tomorrow.");
  if (r.error === "restricted") throw new Error("Your account can't add gyms while reports about it are reviewed.");
  if (!r.id) throw new Error("Could not add the gym.");
  return { id: r.id, created: !!r.created };
}

/** Join or switch gym. Switching turns discovery off (enforced by the database). */
export async function setMyGym(db: DB, gymId: string): Promise<void> {
  const { data: u } = await db.auth.getUser();
  ok(await db.from("gym_memberships").upsert({ user_id: u.user!.id, gym_id: gymId }, { onConflict: "user_id" }));
}

export async function setDiscoverable(db: DB, on: boolean): Promise<void> {
  const { data: u } = await db.auth.getUser();
  ok(await db.from("gym_memberships").update({ discoverable: on }).eq("user_id", u.user!.id));
}

export async function leaveGym(db: DB): Promise<void> {
  const { data: u } = await db.auth.getUser();
  ok(await db.from("gym_memberships").delete().eq("user_id", u.user!.id));
}

export async function gymPeople(db: DB, gymId: string): Promise<Person[]> {
  return ok(await db.rpc("gym_people", { p_gym_id: gymId })) as Person[];
}

export async function gymCounts(db: DB, gymId: string): Promise<GymCounts> {
  return ok(await db.rpc("gym_counts", { p_gym_id: gymId })) as GymCounts;
}

export async function myFriends(db: DB): Promise<Friend[]> {
  return ok(await db.rpc("my_friends")) as Friend[];
}
export async function myRequests(db: DB): Promise<FriendRequest[]> {
  return ok(await db.rpc("my_friend_requests")) as FriendRequest[];
}
export async function myBlocked(db: DB): Promise<Blocked[]> {
  return ok(await db.rpc("my_blocked")) as Blocked[];
}
export async function mySocialStatus(db: DB): Promise<{ restricted: boolean }> {
  return ok(await db.rpc("my_social_status")) as { restricted: boolean };
}

export async function sendFriendRequest(db: DB, to: string): Promise<string> {
  return ok(await db.rpc("send_friend_request", { p_to: to })) as string;
}
export async function respondFriendRequest(db: DB, id: string, accept: boolean): Promise<string> {
  return ok(await db.rpc("respond_friend_request", { p_id: id, p_accept: accept })) as string;
}
export async function cancelFriendRequest(db: DB, id: string): Promise<string> {
  return ok(await db.rpc("cancel_friend_request", { p_id: id })) as string;
}
export async function removeFriend(db: DB, other: string): Promise<string> {
  return ok(await db.rpc("remove_friend", { p_other: other })) as string;
}
export async function blockUser(db: DB, other: string): Promise<string> {
  return ok(await db.rpc("block_user", { p_other: other })) as string;
}
export async function unblockUser(db: DB, other: string): Promise<string> {
  return ok(await db.rpc("unblock_user", { p_other: other })) as string;
}

export async function createInvite(db: DB): Promise<string> {
  const res = await db.rpc("create_friend_invite");
  if (res.error?.message === "rate_limited") throw new Error("You've made several invite links today. Try again tomorrow.");
  if (res.error?.message === "restricted") throw new Error("Your account can't invite people while reports about it are reviewed.");
  return ok(res) as string;
}
export async function invitePreview(db: DB, code: string): Promise<{ status: "valid" | "invalid" | "own" | "already_friends"; display_name?: string }> {
  return ok(await db.rpc("friend_invite_preview", { p_code: code })) as { status: "valid" | "invalid" | "own" | "already_friends"; display_name?: string };
}
export async function acceptInvite(db: DB, code: string): Promise<string> {
  return ok(await db.rpc("accept_friend_invite", { p_code: code })) as string;
}

export type ReportTarget = "user" | "gym" | "message" | "post" | "comment";
export async function report(db: DB, t: { type: ReportTarget; id: string; user: string; reason: ReportReason; details?: string }): Promise<string> {
  return ok(await db.rpc("report_content", {
    p_target_type: t.type, p_target_id: t.id, p_reported_user: t.user, p_reason: t.reason, p_details: t.details ?? null,
  })) as string;
}

/* ---------- profiles (migration 022) ---------- */

/** The public-facing profile as the caller may see it; null when they can't see this person. */
export async function socialProfile(db: DB, userId: string): Promise<SocialProfile | null> {
  const p = ok(await db.rpc("social_profile", { p_user: userId })) as SocialProfile | null;
  return p ? { ...p, interests: p.interests ?? [], can_request: !!p.can_request, can_message: !!p.can_message } : null;
}

export type MyProfileFields = { display_name: string | null; bio: string | null; training_interests: string[]; avatar_path: string | null };

export async function myProfileFields(db: DB): Promise<MyProfileFields> {
  const { data: u } = await db.auth.getUser();
  return ok(await db.from("profiles").select("display_name, bio, training_interests, avatar_path").eq("id", u.user!.id).single()) as MyProfileFields;
}

export async function updateMyProfile(db: DB, p: { displayName: string; bio: string; interests: string[] }): Promise<void> {
  const { data: u } = await db.auth.getUser();
  ok(await db.from("profiles").update({
    display_name: p.displayName.trim().slice(0, 60), bio: p.bio.trim() || null, training_interests: p.interests,
  }).eq("id", u.user!.id));
}

/** Upload an already re-encoded avatar, point the profile at it, then remove the previous file. */
export async function setMyAvatar(db: DB, blob: Blob, previous: string | null): Promise<string> {
  const { data: u } = await db.auth.getUser();
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${u.user!.id}/${crypto.randomUUID()}.${ext}`;
  const up = await db.storage.from("avatars").upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: "3600" });
  if (up.error) throw new Error(up.error.message.includes("size") ? "That photo is too large." : "Couldn't upload the photo. Try again.");
  const res = await db.from("profiles").update({ avatar_path: path }).eq("id", u.user!.id);
  if (res.error) { await db.storage.from("avatars").remove([path]); throw new Error("Couldn't save the photo. Try again."); }
  if (previous && previous !== path) await db.storage.from("avatars").remove([previous]);
  return path;
}

export async function removeMyAvatar(db: DB, previous: string | null): Promise<void> {
  const { data: u } = await db.auth.getUser();
  ok(await db.from("profiles").update({ avatar_path: null }).eq("id", u.user!.id));
  if (previous) await db.storage.from("avatars").remove([previous]);
}
