"use client";

import { useSyncExternalStore } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Today's charger forecast for a hub (PRD HB-2, design-system CapacityBars): utilisation per hour with the
 * capacity line at 100%. Hours over capacity are amber AND hatched (never colour alone); past hours are dimmed.
 */
type Colors = { ok: string; over: string; grid: string; text: string; line: string; surface: string };
const SERVER: Colors = {
  ok: "currentColor",
  over: "currentColor",
  grid: "currentColor",
  text: "currentColor",
  line: "currentColor",
  surface: "transparent",
};
let cached: Colors | null = null;
function tokens(): Colors {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const get = (n: string) => css.getPropertyValue(n).trim() || "currentColor";
  cached = {
    ok: get("--fo-chart-1"),
    over: get("--fo-severity-high"),
    grid: get("--fo-border-divider"),
    text: get("--fo-fg-muted"),
    line: get("--fo-fg-secondary"),
    surface: get("--fo-bg-surface"),
  };
  return cached;
}
const subscribe = () => () => {};

export function ForecastChart({
  hours,
  now,
  timeZone,
}: {
  hours: { hour: number; utilization: number | null; demand: number }[];
  now: number;
  timeZone: string;
}) {
  const c = useSyncExternalStore(subscribe, tokens, () => SERVER);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric" });
  const data = hours.map((h) => ({ ...h, u: h.utilization ?? 0, past: h.hour + 3_600_000 <= now }));
  const max = Math.max(1.2, ...data.map((d) => d.u));
  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-divider bg-surface p-2">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 16, right: 16, bottom: 4, left: 4 }}
            barCategoryGap={2}
            accessibilityLayer
          >
            <defs>
              <pattern id="over-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={c.over} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={c.surface} strokeWidth="2" />
              </pattern>
            </defs>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis
              dataKey="hour"
              tickFormatter={(t) => fmt.format(new Date(Number(t)))}
              tick={{ fill: c.text, fontSize: 12 }}
              stroke={c.grid}
              interval={2}
            />
            <YAxis
              domain={[0, Math.ceil(max * 10) / 10]}
              tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
              tick={{ fill: c.text, fontSize: 12 }}
              stroke={c.grid}
              width={48}
            />
            <ReferenceLine
              y={1}
              stroke={c.line}
              strokeDasharray="4 4"
              label={{ value: "Capacity", fill: c.text, fontSize: 12, position: "insideTopRight" }}
            />
            <Tooltip
              formatter={(v, _n, item) => [
                `${Math.round(Number(v) * 100)}% (${(item.payload as { demand: number }).demand} chargers)`,
                "Forecast",
              ]}
              labelFormatter={(t) => fmt.format(new Date(Number(t)))}
              contentStyle={{ background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 6, fontSize: 12 }}
              cursor={{ fill: c.grid, opacity: 0.4 }}
            />
            <Bar dataKey="u" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.hour} fill={d.u > 1 ? "url(#over-hatch)" : c.ok} fillOpacity={d.past ? 0.45 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="flex flex-wrap justify-center gap-4 text-label text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-3 rounded-sm" style={{ background: c.ok }} /> Within
          capacity
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden="true" width="12" height="12">
            <rect width="12" height="12" rx="2" fill="url(#over-hatch)" />
          </svg>
          Over capacity
        </span>
      </p>
    </div>
  );
}
