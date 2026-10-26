import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL(error ? "/settings?error=signout" : "/login", request.url), { status: 303 });
}
