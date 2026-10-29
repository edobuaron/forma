"use client";
import { format } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TrendLine } from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import type { WeightUnit } from "@/lib/domain/types";
import { displayToKg, kgToDisplay } from "@/lib/domain/units";
import { deleteMeasurement, updateProfile, upsertMeasurement } from "@/lib/data/mutations";
import type { BodyMeasurementRow } from "@/lib/data/types";
import { createClient } from "@/lib/supabase/client";

const FIELDS = [
  { key: "bodyweight_kg", label: "Bodyweight", unit: "weight" },
  { key: "waist_cm", label: "Waist", unit: "cm" },
  { key: "chest_cm", label: "Chest", unit: "cm" },
  { key: "shoulders_cm", label: "Shoulders", unit: "cm" },
  { key: "arms_cm", label: "Arms", unit: "cm" },
  { key: "thighs_cm", label: "Thighs", unit: "cm" },
  { key: "hips_cm", label: "Hips", unit: "cm" },
] as const;
type Key = (typeof FIELDS)[number]["key"];

export function BodyTracker({ rows, unit, profileId }: { rows: BodyMeasurementRow[]; unit: WeightUnit; profileId: string }) {
  const router = useRouter();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [vals, setVals] = useState<Partial<Record<Key, string>>>({});
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState<Key>("bodyweight_kg");
  const u = (f: (typeof FIELDS)[number]) => (f.unit === "weight" ? unit : "cm");

  const series = useMemo(() => [...rows].reverse().filter((r) => r[metric] != null).map((r) => ({
    x: format(new Date(r.measured_on), "d MMM"), title: format(new Date(r.measured_on), "d MMM yyyy"),
    y: metric === "bodyweight_kg" ? kgToDisplay(Number(r[metric]), unit) : Number(r[metric]),
  })), [rows, metric, unit]);
  const latest = rows[0], first = rows[rows.length - 1];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const row: Record<string, unknown> = { measured_on: date };
    for (const f of FIELDS) {
      const s = vals[f.key]?.trim();
      if (!s) continue;
      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n) || n <= 0 || n > 400) return toast.error(`${f.label}: enter a valid number`);
      row[f.key] = f.unit === "weight" ? displayToKg(n, unit) : n;
    }
    if (Object.keys(row).length === 1) return toast.error("Enter at least one measurement.");
    setBusy(true);
    try {
      const db = createClient();
      const existing = rows.find((r) => r.measured_on === date);
      await upsertMeasurement(db, { ...(existing ?? {}), ...row, id: existing?.id });
      if (row.bodyweight_kg && (!latest || date >= latest.measured_on)) await updateProfile(db, profileId, { bodyweight_kg: row.bodyweight_kg as number });
      setVals({});
      toast.success("Saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Log measurements</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <Field label="Date" className="max-w-[200px]"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label} (${u(f)})`}>
                  <Input inputMode="decimal" value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} placeholder={latest?.[f.key] != null ? String(f.unit === "weight" ? kgToDisplay(Number(latest[f.key]), unit) : latest[f.key]) : "—"} />
                </Field>
              ))}
            </div>
            <Button type="submit" variant="primary" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save</Button>
          </form>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <>
          <Card>
            <CardHeader className="flex-col sm:flex-row sm:items-center">
              <div><CardTitle>Trend</CardTitle><p className="mt-0.5 text-[12.5px] text-muted-foreground">{FIELDS.find((f) => f.key === metric)!.label}, {metric === "bodyweight_kg" ? unit : "cm"}</p></div>
              <div className="-mx-1 max-w-full overflow-x-auto px-1"><Segmented size="sm" value={metric} onChange={setMetric} options={FIELDS.map((f) => ({ value: f.key, label: f.label }))} /></div>
            </CardHeader>
            <CardContent>
              {series.length >= 2 ? <TrendLine data={series} suffix={` ${metric === "bodyweight_kg" ? unit : "cm"}`} height={220} color="var(--record)" />
                : <p className="py-12 text-center text-[13px] text-muted-foreground">Two or more entries needed for a trend.</p>}
              {latest && first && latest !== first && latest[metric] != null && first[metric] != null && (
                <p className="mt-2 text-[12.5px] text-muted-foreground tabular">
                  Change since {format(new Date(first.measured_on), "d MMM yyyy")}: {(() => { const d = Number(latest[metric]) - Number(first[metric]); const v = metric === "bodyweight_kg" ? kgToDisplay(d, unit) : Math.round(d * 10) / 10; return `${v > 0 ? "+" : ""}${v} ${metric === "bodyweight_kg" ? unit : "cm"}`; })()}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px] tabular">
                <thead><tr className="text-left text-muted-foreground"><th className="pb-2 font-medium">Date</th>{FIELDS.map((f) => <th key={f.key} className="pb-2 text-right font-medium">{f.label}</th>)}<th /></tr></thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 font-medium">{format(new Date(r.measured_on), "d MMM yyyy")}</td>
                      {FIELDS.map((f) => <td key={f.key} className="py-2 text-right">{r[f.key] == null ? "—" : f.unit === "weight" ? kgToDisplay(Number(r[f.key]), unit) : Number(r[f.key])}</td>)}
                      <td className="py-2 text-right"><button aria-label="Delete" onClick={async () => { if (confirm("Delete this entry?")) { await deleteMeasurement(createClient(), r.id); router.refresh(); } }} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
