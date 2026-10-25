"use client";
import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import type { ExerciseRow } from "@/lib/data/types";

const CAT_LABEL: Record<string, string> = { compound: "Compound", isolation: "Isolation", bodyweight: "Bodyweight", weighted_bodyweight: "Weighted BW", skill: "Skill" };

export function ExerciseSearch({ exercises }: { exercises: ExerciseRow[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return exercises.filter((e) => (cat === "all" || e.category === cat) && (!s || e.name.toLowerCase().includes(s) || [...e.primary_muscles, ...e.secondary_muscles].some((m) => (MUSCLE_LABELS[m] ?? m).toLowerCase().includes(s))));
  }, [q, cat, exercises]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name or muscle" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Segmented value={cat} onChange={setCat} options={[{ value: "all", label: "All" }, ...Object.entries(CAT_LABEL).map(([value, label]) => ({ value, label }))]} />
        </div>
      </div>
      <div className="divide-y overflow-hidden rounded-lg border bg-card">
        {list.map((e) => (
          <Link key={e.id} href={`/exercises/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{e.name}</p>
              <p className="truncate text-[13px] text-muted-foreground">
                {e.primary_muscles.map((m) => MUSCLE_LABELS[m] ?? m).join(", ") || "—"} · {e.equipment}
              </p>
            </div>
            <Badge tone="outline" className="hidden sm:inline-flex">{CAT_LABEL[e.category]}</Badge>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
        {list.length === 0 && <p className="px-4 py-10 text-center text-[14px] text-muted-foreground">No exercises match.</p>}
      </div>
    </div>
  );
}
