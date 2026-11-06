import { notFound } from "next/navigation";
import { Shell } from "@/components/app/shell";
import { AvatarPhotosProvider } from "@/components/community/common";
import { Conversation } from "@/components/community/conversation";
import { EditProfile } from "@/components/community/edit-profile";
import { CommunityHeader } from "@/components/community/header";
import { SaveWorkoutScreen } from "@/components/community/save-workout";
import { FeedScreen, FindScreen, InboxScreen, MyProfileScreen, PersonProfileScreen, ShareChooser } from "@/components/community/screens";
import * as F from "../data";

// Fixture previews of the Community screens. Off unless FORMA_FIXTURES=1, and never in production.
export const dynamic = "force-dynamic";

const u = { me: F.ME, unit: "kg" as const, distUnit: "km" as const };
const none = { gym: null, membership: null, buddies: [], friends: [], incoming: [], posts: [], upcoming: [] };

const SCREENS: Record<string, { path: string; render: () => React.ReactNode }> = {
  feed: { path: "/community", render: () => <FeedScreen {...u} tab="friends" unread={3} restricted={false} friends={F.FRIENDS} incoming={F.REQUESTS} posts={F.FRIEND_POSTS} gym={F.GYM} membership={F.MEMBERSHIP} buddies={[]} upcoming={F.UPCOMING} /> },
  "feed-comments": { path: "/community", render: () => <FeedScreen {...u} tab="friends" unread={3} restricted={false} friends={F.FRIENDS} incoming={[]} posts={F.FRIEND_POSTS} gym={F.GYM} membership={F.MEMBERSHIP} buddies={[]} upcoming={[]} previewComments={F.COMMENTS} /> },
  "feed-no-posts": { path: "/community", render: () => <FeedScreen {...u} {...none} tab="friends" unread={0} restricted={false} friends={F.FRIENDS} /> },
  gym: { path: "/community", render: () => <FeedScreen {...u} tab="gym" unread={3} restricted={false} friends={F.FRIENDS} incoming={[]} posts={F.GYM_POSTS} gym={F.GYM} membership={F.MEMBERSHIP} buddies={F.BUDDIES} upcoming={[]} /> },
  "feed-empty": { path: "/community", render: () => <FeedScreen {...u} {...none} tab="friends" unread={0} restricted={false} /> },
  "gym-empty": { path: "/community", render: () => <FeedScreen {...u} {...none} tab="gym" unread={0} restricted={false} /> },
  inbox: { path: "/community/inbox", render: () => <InboxScreen conversations={F.CONVERSATIONS} friends={F.FRIENDS} requests={1} unread={3} restricted={false} /> },
  "inbox-empty": { path: "/community/inbox", render: () => <InboxScreen conversations={[]} friends={[]} requests={0} unread={0} restricted={false} /> },
  "conversation-invite": { path: "/community/messages/x", render: () => <Conversation live={false} conversationId={F.MARCO_INFO.other_id} me={F.ME} info={F.MARCO_INFO} initialMessages={F.MARCO_MESSAGES} initialInvites={[F.PENDING_INVITE]} myGym={F.GYM} workoutNames={["Push A", "Pull", "Legs"]} /> },
  "conversation-proposed": { path: "/community/messages/x", render: () => <Conversation live={false} conversationId={F.MARCO_INFO.other_id} me={F.ME} info={F.MARCO_INFO} initialMessages={F.MARCO_MESSAGES_PROPOSED} initialInvites={[F.PROPOSED_INVITE]} myGym={F.GYM} workoutNames={[]} /> },
  "invite-form": { path: "/community/messages/x", render: () => <Conversation live={false} openInvite conversationId={F.PEOPLE.elena.id} me={F.ME} info={{ ...F.CONV_INFO, display_name: F.PEOPLE.elena.name, other_id: F.PEOPLE.elena.id }} initialMessages={[]} initialInvites={[]} myGym={F.GYM} workoutNames={["Push A", "Pull", "Legs"]} /> },
  conversation: { path: "/community/messages/x", render: () => <Conversation live={false} conversationId={F.CONV_INFO.other_id} me={F.ME} info={F.CONV_INFO} initialMessages={F.MESSAGES} initialInvites={[F.INVITE]} myGym={F.GYM} workoutNames={["Push A", "Pull", "Legs"]} /> },
  "conversation-empty": { path: "/community/messages/x", render: () => <Conversation live={false} conversationId={F.CONV_INFO.other_id} me={F.ME} info={{ ...F.CONV_INFO, display_name: F.PEOPLE.elena.name, other_id: F.PEOPLE.elena.id }} initialMessages={[]} initialInvites={[]} myGym={null} workoutNames={[]} /> },
  profile: { path: "/community/me", render: () => <MyProfileScreen {...u} profile={F.MY_PROFILE} tab="posts" unread={3} restricted={false} friends={F.FRIENDS} requests={F.REQUESTS} blocked={[]} posts={F.MY_POSTS} gym={F.GYM} /> },
  "profile-empty": { path: "/community/me", render: () => <MyProfileScreen {...u} profile={F.NEW_PROFILE} tab="posts" unread={0} restricted={false} friends={[]} requests={[]} blocked={[]} posts={[]} gym={null} /> },
  person: { path: "/community/u/x", render: () => <PersonProfileScreen {...u} unread={3} restricted={false} profile={F.GIULIA_PROFILE} posts={[F.FRIEND_POSTS[0]]} /> },
  "person-gym": { path: "/community/u/x", render: () => <PersonProfileScreen {...u} unread={0} restricted={false} profile={F.NOEMI_PROFILE} posts={[]} /> },
  "person-pending": { path: "/community/u/x", render: () => <PersonProfileScreen {...u} unread={0} restricted={false} profile={F.TOMMASO_PROFILE} posts={[]} /> },
  "edit-profile": { path: "/community/me", render: () => <><div className="mx-auto max-w-[600px]"><CommunityHeader title="Edit profile" back={{ href: "/community/me", label: "Back" }} showNav={false} /></div><EditProfile me={F.ME} initial={{ displayName: "Alex Demo", bio: F.MY_PROFILE.bio!, interests: F.MY_PROFILE.interests, avatarPath: null, avatarVersion: null }} /></> },
  save: { path: "/community", render: () => <><div className="mx-auto max-w-[680px]"><CommunityHeader title="Save to my programs" back={{ href: "/community", label: "Back" }} showNav={false} /></div><SaveWorkoutScreen preset={{}} postId={F.SAVE_POST.id} author={{ id: F.SAVE_POST.author_id, name: F.SAVE_POST.author_name }} sharedAt={F.SAVE_POST.created_at} snapshot={F.SAVE_POST.snapshot!} library={F.MY_LIBRARY} programs={F.MY_PROGRAMS} previousSaves={[]} {...u} /></> },
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
  return <AvatarPhotosProvider enabled={false}><Shell inProgress={null} pathOverride={s.path}>{s.render()}</Shell></AvatarPhotosProvider>;
}
