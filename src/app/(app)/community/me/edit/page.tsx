import { EditProfile } from "@/components/community/edit-profile";
import { CommunityHeader } from "@/components/community/header";
import { myProfileFields, socialProfile } from "@/lib/data/social";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Edit profile" };

export default async function EditProfilePage() {
  const { supabase, user } = await requireUser();
  const [p, social] = await Promise.all([myProfileFields(supabase), socialProfile(supabase, user.id)]);
  return (
    <>
      <div className="mx-auto max-w-[600px]"><CommunityHeader title="Edit profile" back={{ href: "/community/me", label: "Back to profile" }} showNav={false} /></div>
      <EditProfile me={user.id} initial={{
        displayName: p.display_name ?? "", bio: p.bio ?? "", interests: p.training_interests ?? [],
        avatarPath: p.avatar_path, avatarVersion: social?.avatar ?? null,
      }} />
    </>
  );
}
