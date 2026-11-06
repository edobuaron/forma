import { notFound } from "next/navigation";
import { Shell } from "@/components/app/shell";
import { Conversation } from "@/components/community/conversation";
import { FeedScreen, FindScreen, InboxScreen, MyProfileScreen, PersonProfileScreen, ShareChooser } from "@/components/community/screens";
import * as F from "../data";

// Fixture previews of the Community screens. Off unless FORMA_FIXTURES=1, and never in production.
export const dynamic = "force-dynamic";

const u = { me: F.ME, unit: "kg" as const, distUnit: "km" as const };
const none = { gym: null, membership: null, buddies: [], friends: [], incoming: [], posts: [] };

const SCREENS: Record<string, { path: string; render: () => React.ReactNode }> = {
  feed: { path: "/community", render: () => <FeedScreen {...u} tab="friends" unread={3} restricted={false} friends={F.FRIENDS} incoming={F.REQUESTS} posts={F.FRIEND_POSTS} gym={F.GYM} membership={F.MEMBERSHIP} buddies={[]} /> },
  gym: { path: "/community", render: () => <FeedScreen {...u} tab="gym" unread={3} restricted={false} friends={F.FRIENDS} incoming={[]} posts={F.GYM_POSTS} gym={F.GYM} membership={F.MEMBERSHIP} buddies={F.BUDDIES} /> },
  "feed-empty": { path: "/community", render: () => <FeedScreen {...u} {...none} tab="friends" unread={0} restricted={false} /> },
  "gym-empty": { path: "/community", render: () => <FeedScreen {...u} {...none} tab="gym" unread={0} restricted={false} /> },
  inbox: { path: "/community/inbox", render: () => <InboxScreen conversations={F.CONVERSATIONS} friends={F.FRIENDS} requests={1} unread={3} restricted={false} /> },
  "inbox-empty": { path: "/community/inbox", render: () => <InboxScreen conversations={[]} friends={[]} requests={0} unread={0} restricted={false} /> },
  conversation: { path: "/community/messages/x", render: () => <Conversation live={false} conversationId={F.CONV_INFO.other_id} me={F.ME} info={F.CONV_INFO} initialMessages={F.MESSAGES} initialInvites={[F.INVITE]} myGym={F.GYM} workoutNames={["Push A", "Pull", "Legs"]} /> },
  "conversation-empty": { path: "/community/messages/x", render: () => <Conversation live={false} conversationId={F.CONV_INFO.other_id} me={F.ME} info={{ ...F.CONV_INFO, display_name: F.PEOPLE.elena.name, other_id: F.PEOPLE.elena.id }} initialMessages={[]} initialInvites={[]} myGym={null} workoutNames={[]} /> },
  profile: { path: "/community/me", render: () => <MyProfileScreen {...u} name="Alex Demo" tab="posts" unread={3} restricted={false} friends={F.FRIENDS} requests={F.REQUESTS} blocked={[]} posts={F.MY_POSTS} gym={F.GYM} /> },
  "profile-empty": { path: "/community/me", render: () => <MyProfileScreen {...u} name="New Member" tab="posts" unread={0} restricted={false} friends={[]} requests={[]} blocked={[]} posts={[]} gym={null} /> },
  person: { path: "/community/u/x", render: () => <PersonProfileScreen {...u} unread={3} restricted={false} person={{ id: F.PEOPLE.giulia.id, name: F.PEOPLE.giulia.name, relation: "friends" }} posts={[F.FRIEND_POSTS[0]]} gymName={null} /> },
  find: { path: "/community/find", render: () => <FindScreen gym={F.GYM} membership={F.MEMBERSHIP} people={F.GYM_PEOPLE} restricted={false} unread={3} /> },
  share: { path: "/community/share", render: () => <ShareChooser gym={F.GYM} unread={0} restricted={false} sessions={[
    { id: "a", name: "Push A", started_at: new Date().toISOString(), exercise_count: 5, set_count: 15, shared: false },
    { id: "b", name: "Lower body", started_at: new Date(Date.now() - 2 * 86400000).toISOString(), exercise_count: 3, set_count: 9, shared: true },
  ]} /> },
};

export default async function FixturePage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.FORMA_FIXTURES !== "1" || process.env.NODE_ENV === "production") notFound();
  const s = SCREENS[(await params).screen];
  if (!s) notFound();
  return <Shell inProgress={null} pathOverride={s.path}>{s.render()}</Shell>;
}
