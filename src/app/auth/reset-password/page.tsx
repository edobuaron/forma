import { ResetPasswordForm } from "@/components/auth/reset-password-form";
export const metadata = { title: "Recover password" };
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="pt-safe mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-5 py-10"><h1 className="text-2xl font-semibold">Recover your password</h1><p className="text-sm text-muted-foreground">We'll email you a link to choose a new password.</p><ResetPasswordForm expired={!!error} /></main>;
}
