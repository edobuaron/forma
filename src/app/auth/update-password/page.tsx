import Link from "next/link";
import { PasswordForm } from "@/components/auth/password-form";
import { createClient } from "@/lib/supabase/server";
export const metadata = { title: "Set a new password" };
export default async function UpdatePasswordPage() {
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  return <main className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-5 py-10"><h1 className="text-2xl font-semibold">Set a new password</h1>{error || !data.user ? <><p className="text-sm">Open a valid recovery link to continue. If your link expired, request another one.</p><Link href="/auth/reset-password" className="flex min-h-11 items-center underline">Request a recovery link</Link></> : <PasswordForm recovery />}</main>;
}
