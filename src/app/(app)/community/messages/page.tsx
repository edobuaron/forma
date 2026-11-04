import { BellOff, MessageCircle } from "lucide-react";
import Link from "next/link";
import { Avatar, Panel } from "@/components/community/common";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { myConversations } from "@/lib/data/messages";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Messages" };

function when(iso: string) {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default async function MessagesPage() {
  const { supabase } = await requireUser();
  const list = await myConversations(supabase);
  return (
    <>
      <PageHeader title="Messages" subtitle="Private conversations with friends. Not end-to-end encrypted." />
      <Link href="/community" className="mb-4 inline-flex h-10 items-center text-[14px] font-medium text-muted-foreground hover:text-foreground">← Community</Link>
      {list.length === 0 ? (
        <EmptyState icon={<MessageCircle />} title="No conversations yet">Open a friend from Community and choose Message to start one.</EmptyState>
      ) : (
        <Panel className="max-w-2xl divide-y">
          {list.map((c) => {
            const preview = c.last_kind === "text" ? c.last_body : c.last_kind === "invite" ? "Invitation to train" : "Invitation updated";
            return (
              <Link key={c.conversation_id} href={`/community/messages/${c.conversation_id}`} className="flex min-h-[68px] items-center gap-3 px-4 py-2.5 hover:bg-muted/60">
                <Avatar name={c.display_name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={c.unread > 0 ? "truncate text-[15px] font-bold" : "truncate text-[15px] font-semibold"}>{c.display_name}</span>
                    <time dateTime={c.last_message_at} className="shrink-0 text-[12px] text-muted-foreground">{when(c.last_message_at)}</time>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={c.unread > 0 ? "truncate text-[13px] text-foreground" : "truncate text-[13px] text-muted-foreground"}>{c.last_from_me ? "You: " : ""}{preview}</span>
                    {c.muted && <BellOff aria-label="Muted" className="size-3.5 shrink-0 text-muted-foreground" />}
                  </span>
                </span>
                {c.unread > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white" aria-label={`${c.unread} unread`}>{c.unread}</span>}
              </Link>
            );
          })}
        </Panel>
      )}
    </>
  );
}
