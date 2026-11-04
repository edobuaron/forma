import type { SessionComparisonSummary, StreamComparison } from "@/lib/domain/comparison";
import { sideLabel } from "@/lib/domain/sides";
import type { LoadType, WeightUnit } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { comparisonSummaryText, comparisonText, formatSetLong } from "./format";

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

/** Matched sets vs. extra work, and actual volume with set counts. Nothing when there's nothing to add. */
export function ComparisonSummaryLine({ summary, unit }: { summary: SessionComparisonSummary; unit: WeightUnit }) {
  const t = comparisonSummaryText(summary, unit);
  if (!t.sets && !t.volume) return null;
  return (
    <div className="mt-2 space-y-0.5 text-[12.5px] leading-snug text-muted-foreground tabular">
      {t.sets && <p>{t.sets}</p>}
      {t.volume && <p>{t.volume}</p>}
    </div>
  );
}
