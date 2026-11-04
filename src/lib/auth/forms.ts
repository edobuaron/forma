import { z } from "zod";

/** Which part of the sign-in screen is showing. No mode = the welcome choice. */
export type AuthMode = "welcome" | "signup" | "login";

export function parseAuthMode(value?: string | null): AuthMode {
  return value === "signup" || value === "login" ? value : "welcome";
}

export type FieldErrors = { email?: string; password?: string };

/** Inline, per-field checks run before anything is sent. */
export function authFieldErrors(mode: "signup" | "login", email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!z.email().safeParse(email.trim()).success) errors.email = "Enter a valid email address, like name@example.com.";
  if (!password) errors.password = mode === "signup" ? "Choose a password." : "Enter your password.";
  else if (mode === "signup" && password.length < 8) errors.password = "Use at least 8 characters.";
  return errors;
}

type AuthErrorLike = { message?: string; code?: string; status?: number } | null | undefined;

/** Turns a Supabase Auth error into a short sentence a person can act on. */
export function authErrorMessage(error: AuthErrorLike, mode: "signup" | "login"): string {
  const code = error?.code ?? "";
  const msg = (error?.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "That email and password don't match. Check them, or reset your password.";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "Confirm your email first. Open the link we sent you, or send a new one below.";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "An account with this email already exists. Log in instead.";
  if (code === "weak_password" || msg.includes("password should")) return "Choose a stronger password: at least 8 characters, ideally a passphrase.";
  if (code.startsWith("over_") || error?.status === 429 || msg.includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  if (code === "signup_disabled") return "New accounts can't be created right now.";
  if (msg.includes("fetch") || msg.includes("network")) return "Couldn't reach Forma. Check your connection and try again.";
  return mode === "signup" ? "Couldn't create your account. Please try again." : "Couldn't log you in. Please try again.";
}

/** Whether a login error means the address still needs confirming (so the form offers a resend). */
export function needsConfirmation(error: AuthErrorLike): boolean {
  return error?.code === "email_not_confirmed" || (error?.message ?? "").toLowerCase().includes("email not confirmed");
}
