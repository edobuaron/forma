"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/domain/analytics";

function useParamSetter() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    n.set(k, v);
    router.push(`${path}?${n.toString()}`, { scroll: false });
  };
}

export function TimeframeControl({ value }: { value: TimeframeKey }) {
  const set = useParamSetter();
  return <Segmented value={value} onChange={(v) => set("tf", v)} options={TIMEFRAMES.map((t) => ({ value: t.key, label: t.label }))} />;
}

export function ExerciseSelect({ value, options }: { value: string; options: { id: string; name: string }[] }) {
  const set = useParamSetter();
  return (
    <Select value={value} onChange={(e) => set("ex", e.target.value)} className="h-9 w-full text-[14px] sm:w-64" aria-label="Exercise">
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </Select>
  );
}
