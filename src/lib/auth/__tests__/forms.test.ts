import { describe, expect, it } from "vitest";
import { authErrorMessage, authFieldErrors, needsConfirmation, parseAuthMode } from "@/lib/auth/forms";

describe("auth screen mode", () => {
  it("opens on the welcome choice unless a form is asked for", () => {
    expect(parseAuthMode(undefined)).toBe("welcome");
    expect(parseAuthMode("signup")).toBe("signup");
    expect(parseAuthMode("login")).toBe("login");
    expect(parseAuthMode("magic")).toBe("welcome");
  });
});

describe("inline field errors", () => {
  it("asks for both fields when empty", () => {
    expect(authFieldErrors("login", "", "")).toEqual({ email: "Enter your email address.", password: "Enter your password." });
  });
  it("rejects a malformed email", () => {
    expect(authFieldErrors("signup", "name@", "longenough").email).toMatch(/valid email/);
  });
  it("needs 8 characters only when creating an account", () => {
    expect(authFieldErrors("signup", "a@b.co", "short").password).toBe("Use at least 8 characters.");
    expect(authFieldErrors("login", "a@b.co", "short")).toEqual({});
  });
  it("accepts surrounding spaces in the email", () => {
    expect(authFieldErrors("signup", " a@b.co ", "longenough")).toEqual({});
  });
});

describe("auth error messages", () => {
  it("explains wrong credentials without saying which field", () => {
    expect(authErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" }, "login")).toMatch(/don't match/);
  });
  it("spots an unconfirmed email so a resend can be offered", () => {
    const e = { code: "email_not_confirmed", message: "Email not confirmed" };
    expect(needsConfirmation(e)).toBe(true);
    expect(authErrorMessage(e, "login")).toMatch(/Confirm your email/);
    expect(needsConfirmation({ code: "invalid_credentials" })).toBe(false);
  });
  it("handles rate limits and unknown errors", () => {
    expect(authErrorMessage({ code: "over_email_send_rate_limit" }, "signup")).toMatch(/Too many/);
    expect(authErrorMessage({ status: 429 }, "login")).toMatch(/Too many/);
    expect(authErrorMessage({ message: "boom" }, "signup")).toBe("Couldn't create your account. Please try again.");
  });
});
