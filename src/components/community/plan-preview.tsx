"use client";
import { ClipboardList } from "lucide-react";
import { planExtras, planLine, prescribedLoadLabel, type PlanItem } from "@/lib/domain/shared-copy";
import type { WeightUnit } from "@/lib/domain/types";
import { formatWeight } from "@/lib/domain/units";
import { cn } from "@/lib/utils";

/** The plan a post lets viewers save: prescriptions only, never what was performed. */
export function PlanPreview({ plan, unit, className, title = "Plan viewers can save" }: { plan: PlanItem[]; unit: WeightUnit; className?: string; title?: string }) {
  return (
    <div className={cn("rounded-xl border", className)}>
      <p className="flex items-center gap-1.5 border-b px-4 py-2.5 text-[13px] font-semibold"><ClipboardList className="size-4 text-muted-foreground" /> {title}</p>
      <ol className="divide-y">
        {plan.map((p, i) => {
          const extras = planExtras({
            warmupSets: p.warmup_sets ?? 0, dropSegments: p.drop_segments ?? 0, dropScope: p.drop_scope ?? null, supersetGroup: p.superset_group ?? null,
            tempo: p.tempo ?? null, perSide: !!p.per_side, optional: !!p.optional, targetRir: p.target_rir ?? null, targetRpe: p.target_rpe ?? null,
          });
          return (
            <li key={i} className="px-4 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[14px] font-medium">{p.name}</span>
                <span className={cn("shrink-0 text-[13px] tabular", p.planned === false ? "text-muted-foreground/80" : "text-muted-foreground")}>{planLine(p)}</span>
              </div>
              {(extras.length > 0 || p.target_weight_kg != null) && (
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {[p.target_weight_kg != null ? `Prescribed load ${prescribedLoadLabel(p.target_weight_kg, p.convention, (kg) => formatWeight(kg, unit))}` : null, ...extras].filter(Boolean).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
