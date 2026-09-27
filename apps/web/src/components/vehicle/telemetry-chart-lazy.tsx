"use client";

import dynamic from "next/dynamic";

/** The telemetry chart, loaded in the browser only (design-system: charts load lazily; Recharts isn't SSR-safe). */
export const TelemetryChartLazy = dynamic(() => import("./telemetry-chart").then((m) => m.TelemetryChart), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full animate-pulse rounded-md border border-divider bg-surface motion-reduce:animate-none lg:h-80" />
  ),
});
