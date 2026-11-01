import { notFound } from "next/navigation";
import { ProgramEditor } from "@/components/programs/program-editor";
import { getProfile, getProgram, getProgramVersions, listExercises } from "@/lib/data/queries";
import { distanceUnit } from "@/lib/data/types";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Program" };

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const [program, library, versions, profile] = await Promise.all([getProgram(supabase, id), listExercises(supabase), getProgramVersions(supabase, id), getProfile(supabase)]);
  if (!program) notFound();
  return <ProgramEditor program={program} library={library} versions={versions} unit={distanceUnit(profile)} />;
}
