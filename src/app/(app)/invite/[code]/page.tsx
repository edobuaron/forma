import { AcceptInvite } from "@/components/community/accept-invite";
import { PageHeader } from "@/components/ui/misc";
import { invitePreview } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Friend invite" };

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { supabase } = await requireUser();
  const preview = /^[a-f0-9]{32}$/.test(code) ? await invitePreview(supabase, code) : { status: "invalid" as const };
  return (
    <>
      <PageHeader title="Friend invite" />
      <AcceptInvite code={code} preview={preview} />
    </>
  );
}
