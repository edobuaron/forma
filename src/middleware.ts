import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function middleware(request: NextRequest) {
  // Fixture previews (no account, no database) exist only in local development with FORMA_FIXTURES=1.
  if (process.env.FORMA_FIXTURES === "1" && process.env.NODE_ENV !== "production" && request.nextUrl.pathname.startsWith("/dev/fixtures/")) {
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|jpg|jpeg|webp|ico)$).*)"],
};
