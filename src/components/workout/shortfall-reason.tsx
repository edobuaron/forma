"use client";
import { useId } from "react";
import { Label, Select } from "@/components/ui/input";
import { SHORTFALL_REASONS, shortfallLabel } from "@/lib/domain/shortfall";
import type { ShortfallReason } from "@/lib/domain/types";

/** Optional reason for planned sets that were left out. Empty = not recorded. */
export function ShortfallReasonField({ value, onChange }: { value: ShortfallReason | null; onChange: (v: ShortfallReason | null) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Why were planned sets left out? (optional)</Label>
      <Select id={id} className="w-full" value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as ShortfallReason | null)}>
        <option value="">Not specified</option>
        {SHORTFALL_REASONS.map((r) => <option key={r} value={r}>{shortfallLabel[r]}</option>)}
      </Select>
      <p className="text-[12px] text-muted-foreground">Completed sets are kept as logged. Left-out sets are never recorded as failed.</p>
    </div>
  );
}
