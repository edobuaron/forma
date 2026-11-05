// Disposable fixture data for previewing Community screens without an account or database.
// Every person, gym and message here is made up. Only served when FORMA_FIXTURES=1 outside production.
import type { ConversationInfo, ConversationSummary, Message, TrainingInvite } from "@/lib/data/messages";
import type { FeedPost, WorkoutSnapshot } from "@/lib/data/posts";
import type { Friend, FriendRequest, Membership, Person } from "@/lib/data/social";
import { wallParts, zonedToUtc } from "@/lib/domain/schedule";
import type { Gym } from "@/lib/domain/social";

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const tomorrowAt = (time: string) => (zonedToUtc(wallParts(new Date(NOW + 86400000), "Europe/Rome").date, time, "Europe/Rome") as Date).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ME = id(1);
export const PEOPLE = {
  giulia: { id: id(2), name: "Giulia Romano" },
  marco: { id: id(3), name: "Marco Bianchi" },
  sara: { id: id(4), name: "Sara Conti" },
  luca: { id: id(5), name: "Luca Ferri" },
  elena: { id: id(6), name: "Elena Russo" },
  davide: { id: id(7), name: "Davide Galli" },
  noemi: { id: id(8), name: "Noemi Greco" },
};

export const GYM: Gym = { id: id(100), name: "Iron Lab Navigli", chain: "Iron Lab", address: "Via Vigevano 18", city: "Milano", country: "IT", verified: false } as Gym;
export const MEMBERSHIP: Membership = { gym_id: GYM.id, discoverable: true, joined_at: ago(60 * 24 * 30) };

const friend = (p: { id: string; name: string }, days: number): Friend => ({ user_id: p.id, display_name: p.name, since: ago(60 * 24 * days) });
export const FRIENDS: Friend[] = [friend(PEOPLE.giulia, 40), friend(PEOPLE.marco, 30), friend(PEOPLE.sara, 20), friend(PEOPLE.luca, 12), friend(PEOPLE.elena, 5)];
export const REQUESTS: FriendRequest[] = [{ id: id(200), direction: "incoming", other_id: PEOPLE.davide.id, display_name: PEOPLE.davide.name, created_at: ago(90) }];
export const GYM_PEOPLE: Person[] = [
  { user_id: PEOPLE.giulia.id, display_name: PEOPLE.giulia.name, relation: "friends" },
  { user_id: PEOPLE.davide.id, display_name: PEOPLE.davide.name, relation: "request_received" },
  { user_id: PEOPLE.noemi.id, display_name: PEOPLE.noemi.name, relation: "none" },
  { user_id: id(9), display_name: "Tommaso Villa", relation: "request_sent" },
];

const inc = { loads: true, reps: true, duration: true, runs: true };
const s = (kg: number, reps: number, n: number) => Array.from({ length: n }, () => ({ kg, reps }));

const push: WorkoutSnapshot = {
  name: "Push A", started_at: ago(100), duration_min: 64, include: inc, runs: [],
  exercises: [
    { name: "Bench press", sets: [{ kg: 80, reps: 8 }, { kg: 80, reps: 7 }, { kg: 77.5, reps: 7 }] },
    { name: "Incline dumbbell press", convention: "per_dumbbell", sets: s(28, 10, 3) },
    { name: "Overhead press", sets: s(45, 8, 3) },
    { name: "Cable fly", sets: s(15, 12, 3) },
    { name: "Triceps pushdown", sets: s(30, 12, 3) },
  ],
};
const legs: WorkoutSnapshot = {
  name: "Lower body", started_at: ago(60 * 20), duration_min: 72, include: inc, runs: [],
  exercises: [
    { name: "Back squat", sets: [{ kg: 100, reps: 5 }, { kg: 100, reps: 5 }, { kg: 100, reps: 5 }, { kg: 100, reps: 5 }] },
    { name: "Romanian deadlift", sets: s(80, 8, 3) },
    { name: "Bulgarian split squat", sets: [{ left: { kg: 16, reps: 10 }, right: { kg: 16, reps: 9 } }, { left: { kg: 16, reps: 9 }, right: { kg: 16, reps: 9 } }] },
  ],
};
const run: WorkoutSnapshot = {
  name: "Easy run + core", started_at: ago(60 * 30), duration_min: 48, include: inc,
  exercises: [{ name: "Hanging leg raise", sets: s(0, 12, 3).map(({ reps }) => ({ reps })) }],
  runs: [{ name: "Run", distance_m: 6200, duration_s: 1980 }],
};
const pull: WorkoutSnapshot = {
  name: "Pull", started_at: ago(60 * 52), duration_min: 55, include: { loads: false, reps: true, duration: true, runs: true }, runs: [],
  exercises: [{ name: "Pull-up", sets: [{ reps: 10 }, { reps: 9 }, { reps: 8 }] }, { name: "Barbell row", sets: [{ reps: 10 }, { reps: 10 }, { reps: 10 }] }, { name: "Face pull", sets: [{ reps: 15 }, { reps: 15 }] }],
};

const post = (n: number, who: { id: string; name: string }, minAgo: number, p: Partial<FeedPost>): FeedPost => ({
  id: id(300 + n), author_id: who.id, author_name: who.name, kind: "workout", audience: "friends", gym_id: null, caption: null, snapshot: null,
  starts_at: null, time_zone: null, workout_name: null, created_at: ago(minAgo), reactions: {}, my_reaction: null, comment_count: 0, ...p,
});

export const FRIEND_POSTS: FeedPost[] = [
  post(1, PEOPLE.giulia, 35, { snapshot: push, caption: "Bench finally moving again 🙌", reactions: { "❤️": 4, "🔥": 2 }, my_reaction: "❤️", comment_count: 3 }),
  post(2, PEOPLE.marco, 60 * 19, { snapshot: legs, caption: "Squats felt heavy today but all reps done.", reactions: { "💪": 3 }, comment_count: 1 }),
  post(3, PEOPLE.sara, 60 * 29, { snapshot: run, reactions: { "👏": 2, "❤️": 1 } }),
  post(4, PEOPLE.luca, 60 * 50, { snapshot: pull, caption: "Keeping the weights to myself this week 😄", reactions: { "🔥": 1 } }),
];
export const GYM_POSTS: FeedPost[] = [
  post(5, PEOPLE.davide, 80, { audience: "gym", gym_id: GYM.id, snapshot: { ...legs, name: "Leg day", started_at: ago(110) }, reactions: { "💪": 5 }, comment_count: 2 }),
  post(6, PEOPLE.giulia, 35, { audience: "gym", gym_id: GYM.id, snapshot: push, reactions: { "❤️": 2 } }),
];
export const BUDDIES: FeedPost[] = [
  post(7, PEOPLE.noemi, 120, { kind: "buddy", audience: "gym", gym_id: GYM.id, starts_at: tomorrowAt("19:00"), time_zone: "Europe/Rome", workout_name: "Upper body", caption: "Anyone up for a spotter swap on bench?", comment_count: 1 }),
];
export const MY_POSTS: FeedPost[] = [
  post(8, { id: ME, name: "Alex Demo" }, 60 * 26, { snapshot: { ...push, name: "Push B", started_at: ago(60 * 27) }, caption: "New 5RM on overhead press", reactions: { "🔥": 3, "❤️": 2 }, comment_count: 2 }),
];

export const CONVERSATIONS: ConversationSummary[] = [
  { conversation_id: id(400), other_id: PEOPLE.giulia.id, display_name: PEOPLE.giulia.name, last_message_at: ago(4), last_kind: "text", last_body: "Perfect, see you at 18:30 then 💪", last_from_me: false, unread: 2, muted: false, can_send: "ok" },
  { conversation_id: id(401), other_id: PEOPLE.marco.id, display_name: PEOPLE.marco.name, last_message_at: ago(60 * 3), last_kind: "invite", last_body: null, last_from_me: false, unread: 1, muted: false, can_send: "ok" },
  { conversation_id: id(402), other_id: PEOPLE.sara.id, display_name: PEOPLE.sara.name, last_message_at: ago(60 * 26), last_kind: "text", last_body: "That route along the canal is great", last_from_me: true, unread: 0, muted: false, can_send: "ok" },
  { conversation_id: id(403), other_id: PEOPLE.luca.id, display_name: PEOPLE.luca.name, last_message_at: ago(60 * 24 * 4), last_kind: "text", last_body: "Haha fair enough", last_from_me: false, unread: 0, muted: true, can_send: "ok" },
];

export const CONV_INFO: ConversationInfo = { other_id: PEOPLE.giulia.id, display_name: PEOPLE.giulia.name, can_send: "ok", muted: false };
const msg = (n: number, from: string, min: number, body: string, kind: Message["kind"] = "text", invite?: string): Message =>
  ({ id: id(500 + n), conversation_id: id(400), sender_id: from, kind, body, invite_id: invite ?? null, created_at: ago(min) });
const G = PEOPLE.giulia.id;
export const INVITE: TrainingInvite = {
  id: id(600), conversation_id: id(400), from_id: ME, to_id: G, gym_id: GYM.id, gym_name: GYM.name, starts_at: tomorrowAt("18:30"), time_zone: "Europe/Rome",
  workout_name: "Push A", note: "Bench and overhead, then some arms", status: "accepted", proposed_by: ME, awaiting_id: null, version: 2, updated_at: ago(6),
};
export const MESSAGES: Message[] = [
  msg(1, G, 60 * 24 + 40, "Saw your OHP post, nice one!"),
  msg(2, ME, 60 * 24 + 38, "Thanks! Took me months to get there"),
  msg(3, ME, 60 * 24 + 37, "How's your shoulder doing?"),
  msg(4, G, 60 * 24 + 20, "Much better. Physio says I can start pressing again"),
  msg(5, ME, 14, "Want to train together tomorrow?"),
  msg(6, ME, 13, "", "invite", INVITE.id),
  msg(7, G, 6, "accepted", "invite_event"),
  msg(8, G, 5, "Yes! I'll bring chalk"),
  msg(9, G, 4, "Perfect, see you at 18:30 then 💪"),
];
