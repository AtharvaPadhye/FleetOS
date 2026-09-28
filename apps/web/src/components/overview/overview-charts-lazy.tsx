"use client";

import dynamic from "next/dynamic";

/** Overview charts, loaded in the browser only (Recharts isn't SSR-safe; design-system: charts load lazily). */
const skeleton = () => (
  <div className="h-64 w-full animate-pulse rounded-md border border-divider bg-surface motion-reduce:animate-none" />
);
export const AvailabilityTrendLazy = dynamic(() => import("./overview-charts").then((m) => m.AvailabilityTrend), {
  ssr: false,
  loading: skeleton,
});
export const RevenueVsCostLazy = dynamic(() => import("./overview-charts").then((m) => m.RevenueVsCost), {
  ssr: false,
  loading: skeleton,
});
export const LabelledBarsLazy = dynamic(() => import("./overview-charts").then((m) => m.LabelledBars), {
  ssr: false,
  loading: skeleton,
});
export const PairBarsLazy = dynamic(() => import("./overview-charts").then((m) => m.PairBars), {
  ssr: false,
  loading: skeleton,
});
