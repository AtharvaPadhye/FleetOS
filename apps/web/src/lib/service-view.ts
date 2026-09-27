import type { TicketStatus, TicketType } from "@fleetos/domain";

/** View model for /service (task 5.5): tabs over ticket statuses, in the URL (PRD FL-2 style). */
export const SERVICE_TABS = {
  active: { label: "Active", statuses: ["open", "dispatched", "en_route", "arrived", "in_progress"] },
  completed: { label: "Awaiting return", statuses: ["completed"] },
  closed: { label: "Closed", statuses: ["returned", "cancelled"] },
  all: { label: "All", statuses: [] },
} as const satisfies Record<string, { label: string; statuses: readonly TicketStatus[] }>;
export type ServiceTab = keyof typeof SERVICE_TABS;

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Awaiting dispatch",
  dispatched: "Dispatched",
  en_route: "En route",
  arrived: "Vendor on site",
  in_progress: "In progress",
  completed: "Completed · awaiting return",
  returned: "Returned to service",
  cancelled: "Cancelled",
};
export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  roadside: "Roadside",
  charging: "Charging",
  other: "Other",
};

export function parseServiceView(sp: Record<string, string | string[] | undefined>) {
  const raw = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? "";
  const tab: ServiceTab = raw in SERVICE_TABS ? (raw as ServiceTab) : "active";
  const page = Math.max(1, Math.floor(Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1));
  return { tab, page };
}

export const serviceHref = (tab: ServiceTab, page = 1) => {
  const p = new URLSearchParams();
  if (tab !== "active") p.set("status", tab);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return `/service${qs ? `?${qs}` : ""}`;
};
