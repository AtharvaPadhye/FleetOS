import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { LiveRefresh } from "@/components/live/live-refresh";
import { SlaCountdown } from "@/components/service/sla-countdown";
import { TicketActions } from "@/components/service/ticket-actions";
import { TicketAttachments } from "@/components/service/ticket-attachments";
import { ApiProblem } from "@/lib/api/problem";
import { formatAge, formatCents, formatMinutes, formatWhen } from "@/lib/format";
import { TICKET_STATUS_LABEL, TICKET_TYPE_LABEL } from "@/lib/service-view";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getTicket, listAttachments, ticketEvents, vehicleBlockers, vendorChoices } from "@/lib/services/tickets";

export async function generateMetadata({ params }: PageProps<"/service/[number]">): Promise<Metadata> {
  return { title: decodeURIComponent((await params).number) };
}

const EVENT_LABEL: Record<string, string> = {
  created: "Ticket created",
  vendor_assigned: "Vendor dispatched",
  eta_set: "ETA updated",
  arrived: "Vendor arrived",
  completed: "Service completed",
  returned: "Returned to service",
  cancelled: "Cancelled",
  escalated: "Escalated",
  sla_breached: "SLA breached",
  cost_updated: "Cost corrected",
  note: "Details updated",
  attachment_added: "Attachment added",
  override: "Blocker overridden",
};

/** One ticket (PRD SV-2, SV-3): SLA clock, the next step, costs and lost revenue, and the activity log. */
export default async function TicketPage({ params }: PageProps<"/service/[number]">) {
  const number = decodeURIComponent((await params).number);
  if (!/^SVC-\d{4}-\d{4,}$/.test(number)) notFound();
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const db = await createClient();
  const now = new Date();
  const t = await getTicket(db, activeOrg, { number }, now).catch((e) => {
    if (e instanceof ApiProblem && e.code === "not_found") notFound();
    throw e;
  });
  const [events, blockers, vendors, attachments] = await Promise.all([
    ticketEvents(db, activeOrg, t.id),
    vehicleBlockers(db, activeOrg, t.vehicle.id),
    vendorChoices(db, activeOrg, t.vehicle.id, t.type),
    listAttachments(db, activeOrg, t.id),
  ]);
  const canEdit = ["owner", "admin", "ops"].includes(activeOrg.role);
  const tz = activeOrg.timezone;
  const otherBlockers = [
    ...blockers.tickets.filter((b) => b.id !== t.id).map((b) => `${b.number} (${b.type})`),
    ...blockers.exceptions.filter((b) => b.id !== t.exception_id).map((b) => b.title),
    ...blockers.holds.map((h) => `a manual hold: ${h.reason}`),
  ];
  const facts: [string, React.ReactNode][] = [
    [
      "Vehicle",
      <Link key="v" href={`/fleet/${t.vehicle.number}` as Route} className="underline underline-offset-4">
        Car {t.vehicle.number}
      </Link>,
    ],
    ["Status", TICKET_STATUS_LABEL[t.status]],
    ["Type", TICKET_TYPE_LABEL[t.type]],
    ["Opened", `${formatWhen(t.created_at, tz)} (${formatAge(t.created_at, now.getTime())})`],
    ["Vendor", t.vendor?.name ?? "Not dispatched"],
    ["ETA", formatWhen(t.eta_at, tz, "time")],
    ["Arrived", formatWhen(t.arrived_at, tz, "time")],
    ["Takes car out of service", t.blocks_service ? "Yes" : "No"],
    ["Estimated cost", formatCents(t.estimated_cost_cents)],
    ["Actual cost", formatCents(t.actual_cost_cents)],
    ["Downtime", t.downtime_min === null ? "—" : formatMinutes(t.downtime_min)],
    ["Lost revenue", formatCents(t.lost_revenue_cents)],
  ];
  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh orgId={activeOrg.id} />
      <Link href="/service" className="self-start text-label text-fg-muted underline underline-offset-4">
        ← Service
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            id="main-heading"
            tabIndex={-1}
            className="font-display text-display-l font-semibold [font-stretch:112.5%] focus:outline-none"
          >
            {t.number}
          </h1>
          <SlaCountdown ticket={t} asOf={now.getTime()} className="text-body" />
          {activeOrg.isDemo && t.detection_source === "rule" ? <DataSourceBadge source="simulated" /> : null}
        </div>
        <p className="text-fg-muted">
          {t.description ?? TICKET_TYPE_LABEL[t.type]}
          {t.exception_id ? (
            <>
              {" · "}
              <Link href={`/exceptions/${t.exception_id}` as Route} className="underline underline-offset-4">
                View the exception
              </Link>
            </>
          ) : null}
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-divider bg-surface p-4 sm:grid-cols-3">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-label text-fg-muted">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {canEdit ? (
            <section
              aria-labelledby="next-step"
              className="flex flex-col gap-3 rounded-md border border-divider bg-surface p-4"
            >
              <h2 id="next-step" className="text-title font-semibold">
                Next step
              </h2>
              <TicketActions
                id={t.id}
                status={t.status}
                vehicleNumber={t.vehicle.number}
                vendors={vendors}
                currentVendorId={t.vendor?.id ?? null}
                estimateCents={t.estimated_cost_cents}
                blockers={otherBlockers}
                canOverride={["owner", "admin"].includes(activeOrg.role)}
              />
            </section>
          ) : null}
          <TicketAttachments ticketId={t.id} orgId={activeOrg.id} items={attachments} canUpload={canEdit} />
        </div>
        <section aria-labelledby="activity" className="flex flex-col gap-2">
          <h2 id="activity" className="text-title font-semibold">
            Activity
          </h2>
          <ol className="flex flex-col gap-2 border-l border-divider pl-3">
            {events.map((e) => (
              <li key={e.id} className="text-label">
                <span className="text-fg">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="text-fg-muted">
                  {" "}
                  · {e.actor_name ?? "FleetOS"} · {formatWhen(e.at, tz, "time")}
                </span>
                {typeof e.detail.vendor_name === "string" ? (
                  <p className="text-fg-muted">{e.detail.vendor_name}</p>
                ) : null}
                {typeof e.detail.filename === "string" ? <p className="text-fg-muted">{e.detail.filename}</p> : null}
                {typeof e.detail.actual_cost_cents === "number" ? (
                  <p className="text-fg-muted tabular-nums">
                    {formatCents(e.detail.actual_cost_cents, { decimals: true })}
                  </p>
                ) : null}
                {typeof e.detail.reason === "string" || typeof e.detail.note === "string" ? (
                  <p className="text-fg-muted">“{String(e.detail.reason ?? e.detail.note)}”</p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
