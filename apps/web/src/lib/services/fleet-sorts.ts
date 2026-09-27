/** Sortable fleet-list fields (shared by the API schema and the page; no server-only imports). */
export const FLEET_SORTS = [
  "number",
  "status",
  "soc",
  "status_since",
  "last_telemetry_at",
  "revenue",
  "contribution",
  "revenue_per_hour",
  "downtime",
  "profitability",
] as const;
export type FleetSort = (typeof FLEET_SORTS)[number];
