"use client";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { TrendLine } from "@/components/charts/charts";
import { Segmented } from "@/components/ui/segmented";
import { E1RM_FORMULA, E1RM_MAX_REPS } from "@/lib/domain/e1rm";
import { TIMEFRAMES, timeframeStart, type SessionPoint, type TimeframeKey } from "@/lib/domain/analytics";
import type { LoadType, WeightUnit } from "@/lib/domain/types";
import { formatWeight, kgToDisplay } from "@/lib/domain/units";

type Metric = "e1rm" | "top" | "reps" | "volume" | "totalReps";

export function ExerciseProgressChart({ points, e1rm, unit, loadType, timeframe }: { points: SessionPoint[]; e1rm: boolean; unit: WeightUnit; loadType: LoadType; timeframe?: TimeframeKey }) {
  const bw = loadType === "bodyweight";
  const assisted = loadType === "assisted";
  const metrics: { value: Metric; label: string }[] = [
    ...(e1rm ? [{ value: "e1rm" as const, label: "Est. 1RM" }] : []),
    ...(!bw ? [{ value: "top" as const, label: assisted ? "Assistance" : loadType === "weighted_bodyweight" ? "Added load" : "Top set" }] : []),
    { value: "reps", label: bw ? "Best reps" : "Reps at top" },
    ...(loadType === "external" ? [{ value: "volume" as const, label: "Volume" }] : []),
    { value: "totalReps", label: "Total reps" },
  ];
  const [metric, setMetric] = useState<Metric>(metrics[0].value);
  const [tfState, setTf] = useState<TimeframeKey>("3m");
  const tf = timeframe ?? tfState;

  const data = useMemo(() => {
    const start = timeframeStart(tf);
    return points
      .filter((p) => !start || new Date(p.date) >= start)
      .map((p) => {
        const top = assisted ? -p.topLoadKg : p.topLoadKg;
        const y =
          metric === "e1rm" ? (p.bestE1rmKg != null ? kgToDisplay(p.bestE1rmKg, unit) : null)
          : metric === "top" ? kgToDisplay(top, unit)
          : metric === "reps" ? p.repsAtTop
          : metric === "volume" ? kgToDisplay(p.volumeKg, unit)
          : p.totalReps;
        return {
          x: format(new Date(p.date), "d MMM"),
          title: format(new Date(p.date), "EEE d MMM yyyy"),
          y,
          detail: `${bw ? "BW" : formatWeight(top, unit)} × ${p.repsAtTop} best set · ${p.workingSets} sets`,
        };
      });
  }, [points, tf, metric, unit, assisted, bw]);

  const suffix = metric === "reps" || metric === "totalReps" ? " reps" : ` ${unit}`;

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 overflow-x-auto px-1"><Segmented size="sm" value={metric} onChange={setMetric} options={metrics} /></div>
        {!timeframe && <Segmented size="sm" value={tf} onChange={setTf} options={TIMEFRAMES.map((t) => ({ value: t.key, label: t.label }))} />}
      </div>
      {data.filter((d) => d.y != null).length >= 1 ? (
        <TrendLine data={data} suffix={suffix} height={240} integer={metric === "reps" || metric === "totalReps"} />
      ) : (
        <p className="py-16 text-center text-[13px] text-muted-foreground">No sessions in this timeframe. Choose a longer one above.</p>
      )}
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        One point per session ({metric === "e1rm" ? `best set's estimated 1RM — ${E1RM_FORMULA} formula, sets of ${E1RM_MAX_REPS} reps or fewer; an estimate, not a tested max` : metric === "top" ? "heaviest working set" : metric === "reps" ? "best reps at that session's top load" : metric === "volume" ? "load × reps across working sets; warm-ups and drops not included" : "all working-set reps"}).
      </p>
    </div>
  );
}
