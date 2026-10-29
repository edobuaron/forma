import type { StreamComparison } from "@/lib/domain/comparison";
import { sideLabel } from "@/lib/domain/sides";
import type { LoadType, WeightUnit } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { comparisonText, formatSetLong } from "./format";

/** Completed sets with their comparison, grouped as logged: together, then left, then right. */
export function StreamComparisonList({ items, loadType, unit }: { items: StreamComparison[]; loadType: LoadType; unit: WeightUnit }) {
  const sided = items.some((c) => c.stream !== "together");
  return (
    <div className="space-y-1">
      {items.map((c, i) => {
        const t = comparisonText(c.comparison, unit, loadType);
        const heading = sided && (i === 0 || items[i - 1].stream !== c.stream);
        return (
          <div key={`${c.stream}-${c.index}`}>
            {heading && (
              <p className={cn("text-[11px] font-medium uppercase tracking-wide text-muted-foreground", i > 0 && "pt-1.5")}>
                {c.stream === "together" ? "Logged together" : sideLabel[c.stream]}
              </p>
            )}
            <div className="flex items-center justify-between text-[14px]">
              <span className="tabular"><span className="mr-3 text-muted-foreground">{c.index + 1}</span>{formatSetLong(c.set, loadType, unit)}</span>
              {t && <span className={cn("text-[12.5px]", t.tone === "positive" ? "text-positive" : t.tone === "negative" ? "text-negative" : "text-muted-foreground")}>{t.text}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "Left · Heaviest set" for a side record, the plain label otherwise. */
export function recordLabel(label: string, side: "left" | "right" | null | undefined) {
  return side ? `${sideLabel[side]} · ${label}` : label;
}
