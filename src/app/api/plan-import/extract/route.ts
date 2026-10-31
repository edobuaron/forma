import { NextResponse, type NextRequest } from "next/server";
import { documentProblem, providerStatus, sniffType } from "@/lib/plan-import/document";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Reads a PDF or photo of a workout plan with an external AI/OCR provider. Disabled until a provider is
// configured server-side (PLAN_IMPORT_AI_PROVIDER plus its key, as Vercel environment variables). The
// file is held in memory for this request only and never stored by Forma.
export async function POST(req: NextRequest) {
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const status = providerStatus(process.env);
  if (!status.enabled) {
    return NextResponse.json({ error: "not_configured", message: "Reading PDFs and photos isn't set up on this server yet. Paste the table, or import it as CSV or XLSX." }, { status: 503 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  const problem = documentProblem(file.type, file.size);
  if (problem) return NextResponse.json({ error: "invalid_file", message: problem }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffType(bytes) !== file.type) return NextResponse.json({ error: "invalid_file", message: "The file's contents don't match its type." }, { status: 400 });

  // No provider adapter ships until its setup and running costs are approved; providerStatus() can't be
  // enabled before one exists, so this is unreachable today.
  return NextResponse.json({ error: "not_configured", message: `The "${status.provider}" provider isn't available in this version.` }, { status: 503 });
}
