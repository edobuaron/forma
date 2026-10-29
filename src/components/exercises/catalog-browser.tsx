"use client";
import { Check, Loader2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { CATALOG, GROUP_LABELS, type CatalogExercise, type CatalogGroup } from "@/lib/catalog/catalog";
import { WEIGHT_ENTRY_SHORT } from "@/lib/catalog/conventions";
import { MUSCLE_LABELS } from "@/lib/domain/analytics";
import { addCatalogExercises } from "@/lib/data/mutations";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Owned = Record<string, { id: string; name: string; archived: boolean }>;

function matches(c: CatalogExercise, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return c.name.toLowerCase().includes(s)
    || c.aliases.some((a) => a.toLowerCase().includes(s))
    || [...c.primary, ...c.secondary].some((m) => (MUSCLE_LABELS[m] ?? m).toLowerCase().includes(s));
}

/** Browse the built-in catalog and copy entries into the library. Programs are never changed here. */
export function CatalogBrowser({ owned, initialQuery = "" }: { owned: Owned; initialQuery?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [group, setGroup] = useState<"all" | CatalogGroup>("all");
  const [equipment, setEquipment] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const list = useMemo(
    () => CATALOG.filter((c) => (group === "all" || c.group === group) && (equipment === "all" || c.equipment === equipment) && matches(c, q)),
    [q, group, equipment],
  );

  const toggle = (slug: string) => setPicked((cur) => {
    const next = new Set(cur);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    return next;
  });

  async function add() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const r = await addCatalogExercises(createClient(), [...picked]);
      const parts = [`Added ${r.added.length} exercise${r.added.length === 1 ? "" : "s"} to your library`];
      if (r.skipped.length) parts.push(`${r.skipped.length} skipped (already there as ${r.skipped.map((s) => `“${s.existing_name}”${s.archived ? ", archived" : ""}`).join(", ")})`);
      toast.success(parts.join(". "));
      setPicked(new Set());
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const trimmed = q.trim();
  return (
    <div className="space-y-4 pb-24">
      <p className="rounded-md border-l-[3px] border-accent bg-accent-soft px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
        Adding exercises puts a copy in your library that you can edit. Your programs and past workouts don&apos;t change; add exercises to a workout under Programs.
      </p>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name, alias or muscle" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" />
        </div>
        <Select value={equipment} onChange={(e) => setEquipment(e.target.value)} className="h-11 md:w-44" aria-label="Equipment">
          <option value="all">All equipment</option>
          {["barbell", "dumbbell", "cable", "machine", "smith", "bodyweight"].map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
        </Select>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Segmented value={group} onChange={setGroup} options={[{ value: "all" as const, label: "All" }, ...(Object.keys(GROUP_LABELS) as CatalogGroup[]).map((g) => ({ value: g, label: GROUP_LABELS[g] }))]} />
      </div>

      <div className="divide-y overflow-hidden rounded-lg border bg-card shadow-card">
        {list.map((c) => {
          const have = owned[c.slug];
          const on = picked.has(c.slug);
          const detail = `${c.primary.map((m) => MUSCLE_LABELS[m] ?? m).join(", ")} · ${c.equipment} · ${WEIGHT_ENTRY_SHORT[c.weightEntry]}`;
          if (have) {
            return (
              <Link key={c.slug} href={`/exercises/${have.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-positive-soft text-positive"><Check className="size-3.5" strokeWidth={3} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold tracking-tight">{c.name}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{detail}</span>
                </span>
                <Badge tone="outline">{have.archived ? "Archived in library" : have.name === c.name ? "In library" : `In library as ${have.name}`}</Badge>
              </Link>
            );
          }
          return (
            <button key={c.slug} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(c.slug)}
              className={cn("flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60", on && "bg-accent-soft hover:bg-accent-soft")}>
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-[7px] border-2 border-input transition-colors", on && "border-primary bg-primary text-primary-foreground")}>
                {on && <Check className="size-3.5 animate-pop" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 truncate text-[15px] font-semibold tracking-tight">{c.name}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{detail}</span>
                {c.instructions && <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground/80">{c.instructions}</span>}
              </span>
              {c.category === "skill" && <Badge tone="outline">Skill</Badge>}
              {c.loadType === "assisted" && c.category !== "skill" && <Badge tone="outline">Assisted</Badge>}
            </button>
          );
        })}
        {list.length === 0 && (
          <p className="px-4 py-8 text-center text-[14px] text-muted-foreground">
            Nothing in the catalog matches{trimmed ? ` “${trimmed}”` : ""}.{" "}
            <Link href={trimmed ? `/exercises?q=${encodeURIComponent(trimmed)}` : "/exercises"} className="font-medium text-accent">Create it in your library</Link>
          </p>
        )}
      </div>

      {picked.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+78px)] z-30 flex justify-center px-4 md:bottom-6">
          <div className="flex w-full max-w-md items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-raised animate-in">
            <button type="button" className="h-10 rounded-md px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setPicked(new Set())}>Clear</button>
            <Button variant="primary" disabled={busy} onClick={add}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} Add {picked.size} to library
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
