import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

/**
 * Someone's avatar, for a signed-in viewer who may see that person (profile_visible() in the database,
 * and the Storage policy checks it again). Storage URLs are never handed to the browser. Responses are
 * private to the viewer; nothing is cached by shared caches.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const none = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "private, max-age=120" } });
  if (!UUID.test(id)) return none(404);
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { data: path, error } = await db.rpc("avatar_path_for", { p_user: id });
  if (error || typeof path !== "string" || !path) return none(404);
  const file = await db.storage.from("avatars").download(path);
  if (file.error || !file.data || !TYPES.has(file.data.type)) return none(404);
  return new NextResponse(file.data, {
    headers: {
      "Content-Type": file.data.type,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
