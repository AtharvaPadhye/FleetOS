"use client";

import { useSyncExternalStore } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Overview charts (PRD OV-3), dataviz-validated: series colours are the reference palette's dark steps
 * (chart-1 blue, chart-2 yellow; CVD ΔE 27.4), ember stays reserved for the Bleed line, one axis per chart,
 * thin marks, recessive grid. Identity never rests on colour alone (legend + direct labels), and every chart
 * has a text summary and a table on the server side.
 */
type Colors = { c1: string; c2: string; grid: string; text: string; target: string; surface: string };
const SERVER: Colors = {
  c1: "currentColor",
  c2: "currentColor",
  grid: "currentColor",
  text: "currentColor",
  target: "currentColor",
  surface: "transparent",
};
let cached: Colors | null = null;
function tokens(): Colors {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const get = (n: string) => css.getPropertyValue(n).trim() || "currentColor";
  cached = {
    c1: get("--fo-chart-1"),
    c2: get("--fo-chart-2"),
    grid: get("--fo-border-divider"),
    text: get("--fo-fg-muted"),
    target: get("--fo-fg-secondary"),
    surface: get("--fo-bg-surface"),
  };
  return cached;
}
const subscribe = () => () => {};
const useColors = () => useSyncExternalStore(subscribe, tokens, () => SERVER);

const frame = "h-64 w-full rounded-md border border-divider bg-surface p-2";
const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekday = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const tooltipStyle = (c: Colors) => ({
  contentStyle: { background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 6, fontSize: 12 },
  labelStyle: { color: c.text },
});

export function AvailabilityTrend({
  points,
  target,
}: {
  points: { day: string; availability: number | null }[];
  target: number;
}) {
  const c = useColors();
  return (
    <div className={frame}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 4 }} accessibilityLayer>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={dayLabel}
            tick={{ fill: c.text, fontSize: 12 }}
            stroke={c.grid}
            minTickGap={24}
          />
          <YAxis
            domain={[(min: number) => Math.max(0, Math.floor((Math.min(min, target) - 0.05) * 20) / 20), 1]}
            tickFormatter={pct}
            tick={{ fill: c.text, fontSize: 12 }}
            stroke={c.grid}
            width={48}
          />
          <ReferenceLine
            y={target}
            stroke={c.target}
            strokeDasharray="4 4"
            label={{ value: `Target ${pct(target)}`, fill: c.text, fontSize: 12, position: "insideBottomRight" }}
          />
          <Tooltip
            formatter={(v) => [pct(Number(v)), "Availability"]}
            labelFormatter={(d) => dayLabel(String(d))}
            {...tooltipStyle(c)}
          />
          <Line
            type="linear"
            dataKey="availability"
            stroke={c.c1}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RevenueVsCost({ points }: { points: { day: string; revenue: number; cost: number }[] }) {
  const c = useColors();
  return (
    <div className={frame}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 4 }} barGap={2} accessibilityLayer>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="day" tickFormatter={weekday} tick={{ fill: c.text, fontSize: 12 }} stroke={c.grid} />
          <YAxis tickFormatter={usd} tick={{ fill: c.text, fontSize: 12 }} stroke={c.grid} width={56} />
          <Tooltip
            formatter={(v, n) => [usd(Number(v)), n === "revenue" ? "Ride revenue" : "Operating cost"]}
            labelFormatter={(d) => dayLabel(String(d))}
            {...tooltipStyle(c)}
            cursor={{ fill: c.grid, opacity: 0.4 }}
          />
          <Legend
            itemSorter={(i) => (i.dataKey === "revenue" ? 0 : 1)}
            formatter={(n) => (
              <span style={{ color: c.text, fontSize: 12 }}>{n === "revenue" ? "Ride revenue" : "Operating cost"}</span>
            )}
          />
          <Bar dataKey="revenue" fill={c.c1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="cost" fill={c.c2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars, sorted, direct value labels; one hue (identity comes from the category label). */
export function LabelledBars({
  rows,
  format,
  unit,
}: {
  rows: { label: string; value: number }[];
  format: "hours" | "pct";
  unit: string;
}) {
  const c = useColors();
  const fmt = (v: number) =>
    format === "pct"
      ? pct(v)
      : v >= 1
        ? `${Math.floor(v)} h ${String(Math.round((v % 1) * 60)).padStart(2, "0")} m`
        : `${Math.round(v * 60)} m`;
  return (
    <div
      className="w-full rounded-md border border-divider bg-surface p-2"
      style={{ height: Math.max(120, rows.length * 40 + 24) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 4 }} accessibilityLayer>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="label" width={112} tick={{ fill: c.text, fontSize: 12 }} stroke={c.grid} />
          <Tooltip
            formatter={(v) => [fmt(Number(v)), unit]}
            {...tooltipStyle(c)}
            cursor={{ fill: c.grid, opacity: 0.4 }}
          />
          <Bar dataKey="value" fill={c.c1} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: unknown) => fmt(Number(v))}
              fill={c.text}
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
