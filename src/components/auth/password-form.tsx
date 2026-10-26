"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { passwordProblem } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/client";

export function PasswordForm({ recovery = false }: { recovery?: boolean }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [nonce, setNonce] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true); setError(null);
    try {
      const { error } = await createClient().auth.reauthenticate();
      if (error) throw error;
      setNotice("Check your email for a confirmation code, then save again.");
    } catch { setError("Couldn't send a confirmation code. Try again shortly."); }
    finally { setBusy(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirmation);
    setError(problem); setNotice(null);
    if (problem) return;
    setBusy(true);
    try {
      const { error } = await createClient().auth.updateUser({ password, ...(!recovery ? { current_password: current } : {}), ...(nonce ? { nonce: nonce.trim() } : {}) });
      if (error) {
        if (error.code === "reauthentication_needed" || error.code === "reauthentication_not_valid") setNeedsCode(true);
        throw error;
      }
      setCurrent(""); setPassword(""); setConfirmation(""); setNonce(""); setDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't update your password. Try again."); }
    finally { setBusy(false); }
  }

  if (done) return <div className="space-y-3"><p role="status" className="text-sm">Your password has been updated.</p><Link href="/settings" className="inline-flex min-h-11 items-center text-sm underline">Back to settings</Link></div>;
  return <form onSubmit={submit} className="space-y-4">
    {!recovery && <div className="space-y-1.5"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type={show ? "text" : "password"} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>}
    <div className="space-y-1.5"><Label htmlFor="new-password">New password</Label><Input id="new-password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-hint" /><p id="password-hint" className="text-xs text-muted-foreground">At least 8 characters. A long, unique passphrase is a good choice.</p></div>
    <div className="space-y-1.5"><Label htmlFor="confirm-password">Confirm new password</Label><Input id="confirm-password" type={show ? "text" : "password"} autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></div>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />Show passwords</label>
    {needsCode && <div className="space-y-2"><Label htmlFor="password-code">Email confirmation code</Label><Input id="password-code" autoComplete="one-time-code" value={nonce} onChange={(e) => setNonce(e.target.value)} /><Button type="button" variant="outline" disabled={busy} onClick={sendCode}>Send confirmation code</Button></div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {error && <p role="alert" className="text-sm text-negative">{error}</p>}
    <Button type="submit" variant="primary" size="lg" disabled={busy}>{busy ? "Please wait…" : "Save password"}</Button>
    {!recovery && <Link href="/auth/reset-password" className="flex min-h-11 items-center text-sm underline">Forgot your password or usually use an email link?</Link>}
  </form>;
}
