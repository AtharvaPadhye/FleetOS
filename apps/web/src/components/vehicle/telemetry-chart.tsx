"use client";

import { useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * One telemetry field over time (PRD VD-7, dataviz-validated). Values arrive only when they change, so the
 * line is step-after (a value holds until the next one) and breaks after `holdMs` without data: gaps show
 * as gaps, never as zero. Single series, so no legend (the heading names it); the crosshair tooltip also
 * works from the keyboard (Recharts accessibility layer); the text summary and table carry the same data.
 */
export interface ChartPoint {
  t: number;
  v: number;
}

type Colors = { line: string; grid: string; text: string };
const SERVER_COLORS: Colors = { line: "currentColor", grid: "currentColor", text: "currentColor" };
let cached: Colors | null = null;
/** Token colours for SVG attributes (which can't use CSS variables), read once per page load. */
function tokens(): Colors {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const get = (n: string) => css.getPropertyValue(n).trim() || "currentColor";
  cached = { line: get("--fo-neutral-200"), grid: get("--fo-border-divider"), text: get("--fo-fg-muted") };
  return cached;
}
const subscribe = () => () => {};

export function TelemetryChart({
  points,
  unit,
  label,
  timeZone,
  holdMs,
  from,
  to,
  digits,
}: {
  points: ChartPoint[];
  unit: string;
  label: string;
  timeZone: string;
  holdMs: number;
  from: number;
  to: number;
  digits: number;
}) {
  const color = useSyncExternalStore(subscribe, tokens, () => SERVER_COLORS);
  // Insert a break wherever the next sample is more than holdMs away (Recharts draws nulls as gaps).
  const data: { t: number; v: number | null }[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1];
    if (prev && p.t - prev.t > holdMs)
      data.push({ t: prev.t + holdMs, v: prev.v }, { t: prev.t + holdMs + 1, v: null });
    data.push(p);
  });
  const last = points.at(-1);
  if (last && to - last.t <= holdMs) data.push({ t: to, v: last.v });
  const span = to - from;
  const tick = new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(span > 2 * 86_400_000
      ? { weekday: "short", hour: "2-digit", hourCycle: "h23" }
      : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  } as Intl.DateTimeFormatOptions);
  const full = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const fmt = (v: number) =>
    `${v.toLocaleString("en-US", { maximumFractionDigits: digits })}${unit === "%" ? "" : " "}${unit}`;
  return (
    <div className="h-72 w-full rounded-md border border-divider bg-surface p-2 lg:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }} accessibilityLayer>
          <CartesianGrid stroke={color.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[from, to]}
            tickFormatter={(t: number) => tick.format(new Date(t))}
            stroke={color.grid}
            tick={{ fill: color.text, fontSize: 12 }}
            minTickGap={48}
          />
          <YAxis
            width={64}
            stroke={color.grid}
            tick={{ fill: color.text, fontSize: 12 }}
            tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: digits })}
            domain={["auto", "auto"]}
            label={{ value: unit, angle: -90, position: "insideLeft", fill: color.text, fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: color.text, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { t: number; v: number | null } | undefined;
              if (!active || !p || p.v === null) return null;
              return (
                <div className="rounded-sm border border-divider bg-overlay px-3 py-2 text-label shadow-overlay">
                  <div className="text-body font-semibold text-fg tabular-nums">{fmt(p.v)}</div>
                  <div className="text-fg-muted">
                    {label} · {full.format(new Date(p.t))}
                  </div>
                </div>
              );
            }}
          />
          <Line
            type="stepAfter"
            dataKey="v"
            stroke={color.line}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
