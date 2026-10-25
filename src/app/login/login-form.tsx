"use client";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { createClient } from "@/lib/supabase/client";

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [mode, setMode] = useState<"signin" | "signup" | "magic">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ? "That sign-in link is invalid or expired." : null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
    if (mode === "magic") {
      if (!z.email().safeParse(email).success) return setError("Enter a valid email");
      setBusy(true);
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
      setBusy(false);
      if (error) return setError(error.message);
      return setNotice("Check your inbox for a sign-in link.");
    }
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setBusy(true);
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
    setBusy(false);
    if (error) return setError(error.message);
    if (mode === "signup" && !data.session) return setNotice("Confirm your email to finish creating your account.");
    router.replace(safeNext);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Segmented
        className="grid w-full grid-cols-3"
        value={mode}
        onChange={(m) => { setMode(m); setError(null); setNotice(null); }}
        options={[{ value: "signin", label: "Sign in" }, { value: "signup", label: "Create account" }, { value: "magic", label: "Email link" }]}
      />
      <div className="space-y-2.5">
        <Input type="email" inputMode="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
        {mode !== "magic" && (
          <Input
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12"
          />
        )}
      </div>
      {error && <p className="text-[13px] text-negative">{error}</p>}
      {notice && <p className="text-[13px] text-positive">{notice}</p>}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send link"}
      </Button>
    </form>
  );
}
