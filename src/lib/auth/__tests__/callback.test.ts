import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const exchange = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: exchange } }) }));
import { GET } from "@/app/auth/callback/route";
beforeEach(() => { exchange.mockReset(); exchange.mockResolvedValue({ error: null }); });
describe("recovery callback", () => {
  it("exchanges the one-time code before opening the password form", async () => {
    const res = await GET(new NextRequest("https://forma.example/auth/callback?code=test-code&next=/auth/update-password"));
    expect(exchange).toHaveBeenCalledWith("test-code");
    expect(res.headers.get("location")).toBe("https://forma.example/auth/update-password");
  });
  it("offers a fresh recovery link when the code expires", async () => {
    exchange.mockResolvedValue({ error: { message: "expired" } });
    const res = await GET(new NextRequest("https://forma.example/auth/callback?code=expired&next=/auth/update-password"));
    expect(res.headers.get("location")).toBe("https://forma.example/auth/reset-password?error=expired");
  });
  it("does not trust a recovery destination without a code", async () => {
    const res = await GET(new NextRequest("https://forma.example/auth/callback?next=/auth/update-password"));
    expect(exchange).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/auth/reset-password?error=expired");
  });
  it("cannot redirect a valid session to an external host", async () => {
    const res = await GET(new NextRequest("https://forma.example/auth/callback?code=valid&next=%2F%5Cevil.example"));
    expect(res.headers.get("location")).toBe("https://forma.example/");
  });
});
