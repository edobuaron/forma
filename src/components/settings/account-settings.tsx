"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PasswordForm } from "@/components/auth/password-form";
import { createClient } from "@/lib/supabase/client";

export function AccountSettings({ email }: { email?: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function signOutOthers() {
    if (!confirm("Sign out your other devices? This device will stay signed in. Unsynced changes on other devices should be saved first.")) return;
    setBusy(true); setNotice(null); setError(null);
    try {
      const { error } = await createClient().auth.signOut({ scope: "others" });
      if (error) throw error;
      setNotice("Other sessions have been revoked. Existing access may continue until their current token expires. This device stays signed in.");
    } catch { setError("Couldn't sign out other devices. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-2"><h2 className="mb-0.5 px-1 text-[15px] font-semibold tracking-tight">Account & security</h2><div className="divide-y rounded-lg border bg-card shadow-card">
    <div className="px-4 py-3"><p className="text-[15px] font-medium">Signed in as</p><p className="break-all text-sm text-muted-foreground">{email ?? "Email unavailable"}</p></div>
    <details className="px-4 py-3"><summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Change password</summary><div className="py-3"><PasswordForm /></div></details>
    <div className="space-y-2 px-4 py-3"><p className="text-[15px] font-medium">Other devices</p><p className="text-sm text-muted-foreground">Revoke other sign-ins while keeping this device connected.</p><Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={signOutOthers}>{busy ? "Signing out…" : "Sign out other devices"}</Button>{notice && <p role="status" className="text-sm">{notice}</p>}{error && <p role="alert" className="text-sm text-negative">{error}</p>}</div>
  </div></section>;
}
