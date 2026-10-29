import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { AddStarterButton, NewProgramButton } from "@/components/programs/program-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { getProgram, listPrograms } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";

export const metadata = { title: "Programs" };

export default async function ProgramsPage() {
  const { supabase } = await requireUser();
  const programs = await listPrograms(supabase);
  const full = await Promise.all(programs.map((p) => getProgram(supabase, p.id)));
  return (
    <>
      <PageHeader title="Programs" subtitle="Templates define what you plan to do. Workouts record what you did." actions={<NewProgramButton />} />
      {programs.length === 0 && (
        <EmptyState title="No programs yet" action={<div className="flex flex-wrap justify-center gap-2"><NewProgramButton /><AddStarterButton /></div>}>
          A program holds the workouts you plan to do. Create one and add workouts and exercises, or add a fresh copy of the 4-day starter program.
        </EmptyState>
      )}
      <div className="space-y-3">
        {full.filter(Boolean).map((p) => (
          <Link key={p!.id} href={`/programs/${p!.id}`} className="block rounded-lg border bg-card p-5 shadow-card hover:bg-muted/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-semibold tracking-tight">{p!.name}</h2>
                  {p!.is_active && <Badge tone="accent">Active</Badge>}
                  {p!.starter_version != null && <Badge tone="outline">Starter</Badge>}
                  <Badge tone="outline">v{p!.version}</Badge>
                </div>
                {p!.description && <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{p!.description}</p>}
              </div>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {p!.templates.length === 0 && <span className="text-[12.5px] text-muted-foreground">No workouts yet. Open the program to add one.</span>}
              {p!.templates.map((t) => (
                <span key={t.id} className="rounded-md bg-subtle px-2.5 py-1 text-[12.5px]">
                  <span className="font-medium">{t.name}</span>
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
      {programs.length > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2 text-center text-[13px] text-muted-foreground">
          <p>Want the 4-day starter back? It&apos;s added as a new copy; nothing else changes.</p>
          <AddStarterButton />
        </div>
      )}
    </>
  );
}
