"use client";
// Chart primitives. Each chart has one series colour chosen by what it measures (blue = load/volume,
// teal = consistency, violet = body/secondary); comparison context uses neutral blue-gray.
// Thin marks, recessive grid, hover tooltips. One y-axis per chart, always.
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";

export interface Point {
  x: string; // label on the axis
  y: number | null;
  detail?: string; // tooltip secondary line
  title?: string; // tooltip title (defaults to x)
}

function Tip({ active, payload, suffix }: { active?: boolean; payload?: readonly { payload?: unknown }[]; suffix: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  if (p.y == null) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-[12px] shadow-raised">
      <p className="text-muted-foreground">{p.title ?? p.x}</p>
      <p className="num mt-0.5 text-[15px] text-foreground">{p.y.toLocaleString("en-US")}{suffix}</p>
      {p.detail && <p className="mt-0.5 text-muted-foreground tabular">{p.detail}</p>}
    </div>
  );
}

const axisProps = { tickLine: false, axisLine: false, tickMargin: 8, minTickGap: 24 } as const;
const compact = (v: number) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(v));

/** `suffix` is appended to values in tooltips, e.g. " kg" or " reps" (a string so server components can pass it). */
export function TrendLine({ data, suffix = "", height = 220, domainPad = 0.08, integer = false, color = "var(--accent)" }: { data: Point[]; suffix?: string; height?: number; domainPad?: number; integer?: boolean; color?: string }) {
  const ys = data.map((d) => d.y).filter((v): v is number => v != null);
  const min = Math.min(...ys), max = Math.max(...ys);
  const pad = Math.max((max - min) * domainPad, max * 0.02, 1);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis dataKey="x" {...axisProps} />
          <YAxis {...axisProps} width={44} allowDecimals={!integer} domain={ys.length ? [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)] : [0, 1]} tickFormatter={compact} />
          <Tooltip content={(p) => <Tip active={p.active} payload={p.payload as readonly { payload?: unknown }[]} suffix={suffix} />} cursor={{ strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2.25}
            dot={{ r: 3.5, fill: "var(--card)", stroke: color, strokeWidth: 2 }}
            activeDot={{ r: 5.5, fill: color, stroke: "var(--card)", strokeWidth: 2 }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Bars({ data, suffix = "", height = 180, highlightLast = false, color = "var(--accent)" }: { data: Point[]; suffix?: string; height?: number; highlightLast?: boolean; color?: string }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="x" {...axisProps} minTickGap={4} />
          <YAxis {...axisProps} width={44} allowDecimals={false} tickFormatter={compact} />
          <Tooltip content={(p) => <Tip active={p.active} payload={p.payload as readonly { payload?: unknown }[]} suffix={suffix} />} cursor={{ fill: "var(--muted)" }} />
          <Bar
            dataKey="y"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const { x, y, width, height: h, index } = props as { x: number; y: number; width: number; height: number; index: number };
              const fill = highlightLast && index !== data.length - 1 ? "var(--chart-muted)" : color;
              if (!h || h <= 0) return <g />;
              const r = Math.min(5, width / 2, h);
              return <path d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + h} Z`} fill={fill} />;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for categories (e.g. sets per muscle group). Plain HTML: crisp, accessible, labels never collide. */
export function HBarList({ items, max, color = "var(--accent)" }: { items: { label: string; value: number; sub?: string }[]; max?: number; color?: string }) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3 text-[13px]" title={i.sub}>
          <span className="truncate text-muted-foreground">{i.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-subtle">
            <span className="block h-full rounded-full" style={{ width: `${(i.value / m) * 100}%`, background: color }} />
          </span>
          <span className="w-10 text-right font-semibold tabular">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}
