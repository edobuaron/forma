"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { acceptInvite } from "@/lib/data/social";
import { createClient } from "@/lib/supabase/client";
import { Avatar, Panel } from "./common";

type Preview = { status: "valid" | "invalid" | "own" | "already_friends"; display_name?: string };

export function AcceptInvite({ code, preview }: { code: string; preview: Preview }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (preview.status === "invalid") {
    return <EmptyState title="This invite can't be used" action={<Button asChild variant="outline"><Link href="/community">Go to Community</Link></Button>}>It may have expired, already been used, or been withdrawn.</EmptyState>;
  }
  if (preview.status === "own") {
    return <EmptyState title="This is your own invite" action={<Button asChild variant="outline"><Link href="/community">Go to Community</Link></Button>}>Send the link to the person you want to add.</EmptyState>;
  }
  if (preview.status === "already_friends") {
    return <EmptyState title={`You're already friends with ${preview.display_name}`} action={<Button asChild variant="outline"><Link href="/community">Go to Community</Link></Button>} />;
  }
  const name = preview.display_name ?? "Someone";
  return (
    <Panel className="max-w-md p-5">
      <div className="flex items-center gap-3">
        <Avatar name={name} className="size-12 text-[16px]" />
        <div><p className="text-[17px] font-semibold">{name}</p><p className="text-[13px] text-muted-foreground">invited you to be friends on Forma</p></div>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">Friends can message you and see only the workouts you choose to share with them. Your history stays private.</p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" size="lg" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const r = await acceptInvite(createClient(), code);
            if (r === "accepted") { toast.success(`You're now friends with ${name}`); router.push("/community"); router.refresh(); }
            else toast.error(r === "restricted" ? "Your account can't add friends while reports about it are reviewed." : "This invite can't be used any more.");
          } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}>Accept</Button>
        <Button asChild variant="ghost" size="lg"><Link href="/community">Not now</Link></Button>
      </div>
    </Panel>
  );
}
