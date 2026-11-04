"use client";
import { Activity, ArrowLeft, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authErrorMessage, authFieldErrors, needsConfirmation, parseAuthMode, type AuthMode, type FieldErrors } from "@/lib/auth/forms";
import { safeRedirect } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * The signed-out screen: a welcome choice, then either the registration form or the login form.
 * The mode lives in the URL (?mode=signup|login) so Back returns to the choice, and the email typed
 * in one form carries over when switching to the other.
 */
export function AuthScreen({ next, initialError }: { next?: string; initialError?: string }) {
  const params = useSearchParams();
  const mode = parseAuthMode(params.get("mode") ?? (initialError ? "login" : null));
  const [email, setEmail] = useState("");
  const safeNext = safeRedirect(next);

  function go(to: AuthMode) {
    const q = new URLSearchParams();
    if (to !== "welcome") q.set("mode", to);
    if (next && safeNext !== "/") q.set("next", safeNext);
    const s = q.toString();
    window.history.pushState(null, "", s ? `/login?${s}` : "/login");
  }

  return (
    <div className="relative w-full max-w-[380px]">
      <div className={cn("flex flex-col items-center text-center", mode === "welcome" ? "mb-10" : "mb-7")}>
        <ForMark size={mode === "welcome" ? "lg" : "sm"} />
        {mode === "welcome" ? (
          <>
            <h1 className="text-[34px] font-bold tracking-[-0.035em]">Forma</h1>
            <p className="mt-2 max-w-[280px] text-[15px] leading-relaxed text-muted-foreground">Log your workouts and see your strength progress over time.</p>
          </>
        ) : (
          <h1 className="text-[26px] font-bold tracking-[-0.03em]">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        )}
      </div>

      {mode === "welcome" ? (
        <div className="space-y-3">
          <Button variant="primary" size="xl" className="w-full" onClick={() => go("signup")}>Create an account</Button>
          <Button variant="outline" size="xl" className="w-full" onClick={() => go("login")}>Log in</Button>
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-card p-5 shadow-raised sm:p-6">
            <AuthForm key={mode} mode={mode} email={email} setEmail={setEmail} safeNext={safeNext} initialError={mode === "login" ? initialError : undefined} />
          </div>
          <p className="mt-6 text-center text-[14px] text-muted-foreground">
            {mode === "signup" ? "Already have an account? " : "New to Forma? "}
            <button type="button" onClick={() => go(mode === "signup" ? "login" : "signup")} className="inline-flex min-h-11 items-center font-semibold text-accent hover:underline">
              {mode === "signup" ? "Log in" : "Create an account"}
            </button>
          </p>
          <button type="button" onClick={() => go("welcome")} className="mx-auto mt-1 flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden /> Back
          </button>
        </>
      )}
    </div>
  );
}

function ForMark({ size }: { size: "lg" | "sm" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid place-items-center bg-primary text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)]",
        size === "lg" ? "mb-5 size-14 rounded-[16px] [&_svg]:size-6" : "mb-4 size-11 rounded-[13px] [&_svg]:size-5",
      )}
    >
      <Activity strokeWidth={2.4} />
    </span>
  );
}

function AuthForm({ mode, email, setEmail, safeNext, initialError }: {
  mode: "signup" | "login";
  email: string;
  setEmail: (v: string) => void;
  safeNext: string;
  initialError?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(initialError ? "That link is invalid or has expired. Log in, or request a new link." : null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => { (email ? passwordRef : emailRef).current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setError(null); setUnconfirmed(false);
    const problems = authFieldErrors(mode, email, password);
    setFields(problems);
    if (problems.email) return emailRef.current?.focus();
    if (problems.password) return passwordRef.current?.focus();
    const address = email.trim();
    inFlight.current = true; setBusy(true);
    let leaving = false;
    try {
      const supabase = createClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) { setUnconfirmed(needsConfirmation(error)); return setError(authErrorMessage(error, mode)); }
      } else {
        const { data, error } = await supabase.auth.signUp({ email: address, password, options: { emailRedirectTo: callback() } });
        if (error) return setError(authErrorMessage(error, mode));
        // With email confirmation on, an address that is already registered comes back with no identities.
        if (data.user && data.user.identities?.length === 0) return setError(authErrorMessage({ code: "user_already_exists" }, mode));
        if (!data.session) { setPassword(""); return setSentTo(address); }
      }
      // Signed in. The app sends a new account to setup first; the tutorial follows setup.
      leaving = true; // keep the button busy while the next page loads
      router.replace(safeNext);
      router.refresh();
    } catch (err) {
      setError(authErrorMessage(err instanceof Error ? { message: err.message } : null, mode));
    } finally {
      if (!leaving) { inFlight.current = false; setBusy(false); }
    }
  }

  async function resendConfirmation(address: string) {
    if (resend === "sending") return;
    setResend("sending"); setError(null);
    const { error } = await createClient().auth.resend({ type: "signup", email: address, options: { emailRedirectTo: callback() } });
    if (error) { setResend("idle"); return setError(authErrorMessage(error, "signup")); }
    setResend("sent");
  }

  if (sentTo) {
    return (
      <div className="space-y-4 text-center" role="status">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-positive-soft text-positive"><MailCheck className="size-6" aria-hidden /></span>
        <div className="space-y-1.5">
          <h2 className="text-[18px] font-semibold tracking-[-0.015em]">Check your email</h2>
          <p className="text-[14px] leading-relaxed text-muted-foreground">
            We sent a confirmation link to<span className="block font-medium text-foreground [overflow-wrap:anywhere]">{sentTo}</span>Open it on this device to finish creating your account.
          </p>
        </div>
        <Button variant="outline" size="lg" className="w-full" disabled={resend !== "idle"} onClick={() => resendConfirmation(sentTo)}>
          {resend === "sending" && <Loader2 className="animate-spin" aria-hidden />}
          {resend === "sent" ? "Email sent again" : resend === "sending" ? "Sending…" : "Resend email"}
        </Button>
        {error && <p role="alert" className="text-[13px] text-negative">{error}</p>}
        <p className="text-[12.5px] text-muted-foreground">Not there? Check spam, or wait a minute before resending.</p>
      </div>
    );
  }

  const emailId = `${id}-email`, passwordId = `${id}-password`;
  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy}>
      <div className="space-y-1.5">
        <Label htmlFor={emailId} className="text-foreground">Email</Label>
        <Input
          ref={emailRef}
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete={mode === "signup" ? "email" : "username"}
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (fields.email) setFields((f) => ({ ...f, email: undefined })); }}
          aria-invalid={!!fields.email}
          aria-describedby={fields.email ? `${emailId}-error` : undefined}
          className={cn("h-12", fields.email && "border-negative focus-visible:border-negative")}
        />
        {fields.email && <p id={`${emailId}-error`} className="text-[13px] text-negative">{fields.email}</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={passwordId} className="text-foreground">Password</Label>
          {mode === "login" && <Link href="/auth/reset-password" className="text-[13px] font-medium text-accent hover:underline">Forgot password?</Link>}
        </div>
        <div className="relative">
          <Input
            ref={passwordRef}
            id={passwordId}
            name="password"
            type={show ? "text" : "password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            autoCapitalize="none"
            spellCheck={false}
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (fields.password) setFields((f) => ({ ...f, password: undefined })); }}
            aria-invalid={!!fields.password}
            aria-describedby={[fields.password && `${passwordId}-error`, mode === "signup" && `${passwordId}-hint`].filter(Boolean).join(" ") || undefined}
            className={cn("h-12 pr-12", fields.password && "border-negative focus-visible:border-negative")}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {show ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
          </button>
        </div>
        {fields.password && <p id={`${passwordId}-error`} className="text-[13px] text-negative">{fields.password}</p>}
        {mode === "signup" && !fields.password && <p id={`${passwordId}-hint`} className="text-[12.5px] text-muted-foreground">At least 8 characters.</p>}
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-negative-soft px-3 py-2.5 text-[13px] leading-snug text-foreground">
          {error}
          {unconfirmed && (
            <button type="button" disabled={resend !== "idle"} onClick={() => resendConfirmation(email.trim())} className="mt-1 block font-semibold text-accent hover:underline disabled:opacity-60">
              {resend === "sent" ? "Confirmation email sent" : resend === "sending" ? "Sending…" : "Send confirmation email again"}
            </button>
          )}
        </div>
      )}

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {busy ? (mode === "signup" ? "Creating account…" : "Logging in…") : mode === "signup" ? "Create account" : "Log in"}
      </Button>
    </form>
  );
}
