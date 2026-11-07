import { notFound } from "next/navigation";
import { Conversation } from "@/components/community/conversation";
import { getMyGym } from "@/lib/data/social";
import { conversationInfo, loadInvites, loadMessages } from "@/lib/data/messages";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invite?: string }> }) {
  const { id } = await params;
  const openInvite = (await searchParams).invite === "1";
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { supabase, user } = await requireUser();
  const info = await conversationInfo(supabase, id);
  if (!info) notFound();
  const [messages, invites, mine, templates] = await Promise.all([
    loadMessages(supabase, id),
    loadInvites(supabase, id),
    getMyGym(supabase),
    supabase.from("workout_templates").select("name, programs!inner(is_active)").eq("programs.is_active", true).then((r) => (r.data ?? []) as { name: string }[]),
  ]);
  return (
    <Conversation
      conversationId={id}
      me={user.id}
      info={info}
      initialMessages={messages}
      initialInvites={invites}
      myGym={mine.gym}
      workoutNames={Array.from(new Set(templates.map((t) => t.name)))}
      openInvite={openInvite}
    />
  );
}
