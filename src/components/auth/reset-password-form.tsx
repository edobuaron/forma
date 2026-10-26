"use client";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm({ expired = false }: { expired?: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(expired ? "That recovery link is invalid or expired. Request a new one below." : null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!z.email().safeParse(email.trim()).success) return setError("Enter a valid email address.");
    setBusy(true);
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
      });
      if (error) throw error;
      setSent(true);
    } catch { setError("Couldn't send the recovery request. Please try again in a minute."); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {sent ? <p role="status" className="text-sm">If an account exists for that address, you'll receive a recovery link. Check your spam folder too. Open the link in this browser.</p> : <>
        <div className="space-y-1.5"><Label htmlFor="recovery-email">Account email</Label><Input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send recovery link"}</Button>
      </>}
      {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      {sent && <Button type="button" variant="outline" onClick={() => setSent(false)}>Try another email or request again</Button>}
      <Link href="/login" className="flex min-h-11 items-center text-sm underline">Back to sign in</Link>
    </form>
  );
}
