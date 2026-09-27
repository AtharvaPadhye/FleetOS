/**
 * Service tickets (task 5.5, PRD SV-1..6; kpis.md §3.3). Pure rules shared by the database adapter, the API
 * and the screens: which status a blocking ticket forces, SLA state, response time, revenue recovered.
 */
import type { ExceptionClass } from "./exceptions";
import type { VendorCategory } from "./vendors";

export const TICKET_TYPES = ["cleaning", "maintenance", "roadside", "charging", "other"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TICKET_STATUSES = [
  "open",
  "dispatched",
  "en_route",
  "arrived",
  "in_progress",
  "completed",
  "returned",
  "cancelled",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** Work still to do (kpis.md: not completed / cancelled); `completed` waits only for return to service. */
export const ACTIVE_TICKET_STATUSES: readonly TicketStatus[] = [
  "open",
  "dispatched",
  "en_route",
  "arrived",
  "in_progress",
];
export const isActiveTicket = (s: TicketStatus) => ACTIVE_TICKET_STATUSES.includes(s);

export const TICKET_ACTIONS = [
  "assign-vendor",
  "escalate",
  "mark-arrived",
  "complete",
  "return-to-service",
  "cancel",
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

/** A blocking ticket's type → the exception class whose status it forces (vehicle-states.md §3). */
export const TICKET_BLOCKS_AS: Record<TicketType, ExceptionClass> = {
  roadside: "incident", // a car waiting for a tow or tyre service is an Incident (vehicle-states.md §8, car 052)
  maintenance: "maintenance",
  cleaning: "cleaning",
  charging: "charging", // doesn't block: charging is planned downtime the engine derives itself
  other: "maintenance",
};

/** The ticket type for an exception of this class (EX-4 "create ticket"). */
export const TICKET_TYPE_FOR_CLASS: Record<ExceptionClass, TicketType> = {
  incident: "roadside",
  maintenance: "maintenance",
  cleaning: "cleaning",
  charging: "charging",
  other: "other",
};

/** Vendor categories that can do a ticket type, best fit first (for ranking and estimates). */
export const VENDOR_CATEGORIES_FOR: Record<TicketType, VendorCategory[]> = {
  cleaning: ["cleaning", "detailing"],
  maintenance: ["maintenance"],
  roadside: ["towing", "tyres"],
  charging: ["charging"],
  other: ["maintenance"],
};

export type SlaState = "on_track" | "at_risk" | "breached" | "met" | "n/a";
/** "At risk" once less than a quarter of the SLA window is left. */
export const SLA_AT_RISK_SHARE = 0.25;

export function slaState(
  t: { status: TicketStatus; created_at: string; sla_due_at: string | null; completed_at: string | null },
  now: number,
): SlaState {
  if (!t.sla_due_at || t.status === "cancelled") return "n/a";
  const due = Date.parse(t.sla_due_at);
  if (t.completed_at) return Date.parse(t.completed_at) <= due ? "met" : "breached";
  if (now > due) return "breached";
  const window = due - Date.parse(t.created_at);
  return due - now < window * SLA_AT_RISK_SHARE ? "at_risk" : "on_track";
}
