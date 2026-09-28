import type { CovenantStatus } from "@fleetos/domain";

/**
 * A monthly report snapshot (task 5.9, PRD RP-1): everything the report shows, frozen at generation. Stored
 * as JSON on the report row; the in-app view, the share link and the PDF render exactly this.
 */
export interface ReportData {
  org_name: string;
  month: string;
  period: { from: string; to: string };
  preliminary: boolean;
  data_source: "simulated" | "live";
  summary: {
    revenue_cents: number;
    contribution_cents: number;
    contribution_margin: number | null;
    net_contribution_cents: number;
    availability: number | null;
    uptime: number | null;
    fleet_size: number;
    revenue_per_vehicle_cents: number | null;
    downtime_cost_cents: number | null;
  };
  grade: { letter: string; score: number; components: Record<string, number | null> } | null;
  covenants: {
    label: string;
    metric: string;
    value: number | null;
    threshold: number;
    operator: string;
    status: CovenantStatus;
  }[];
  availability_by_day: { day: string; availability: number | null }[];
  pnl: { label: string; cents: number; kind: "line" | "total"; share: number | null }[];
  vehicles: {
    labels: { strong: number; monitor: number; review: number };
    top: { number: string; revenue_cents: number; margin: number | null }[];
    bottom: { number: string; revenue_cents: number; margin: number | null }[];
  };
  maintenance: {
    tickets: number;
    cost_cents: number;
    sla_compliance: number | null;
    median_resolution_min: number | null;
    downtime_hours: number;
  };
  incidents: {
    tracked: boolean;
    exceptions: number;
    autonomy_incidents: number | null;
    rides: number | null;
    per_10k_rides: number | null;
  };
  vendors: { name: string; jobs: number; avg_cost_cents: number | null; sla_compliance: number | null }[];
  hubs: { name: string; revenue_cents: number; margin: number | null; cars: number }[];
  risks: string[];
}
