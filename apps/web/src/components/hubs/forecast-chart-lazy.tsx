"use client";

import dynamic from "next/dynamic";

export const ForecastChartLazy = dynamic(() => import("./forecast-chart").then((m) => m.ForecastChart), {
  ssr: false,
  loading: () => (
    <div className="h-72 w-full animate-pulse rounded-md border border-divider bg-surface motion-reduce:animate-none" />
  ),
});
