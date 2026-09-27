import type { Metadata, Route } from "next";
import Link from "next/link";
import { Wrench } from "lucide-react";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { cn } from "@fleetos/ui/lib/cn";
import { LiveRefresh } from "@/components/live/live-refresh";
import { SlaCountdown } from "@/components/service/sla-countdown";
import { PageHeader } from "@/components/shell/page-header";
import { formatAge, formatCents, formatPct } from "@/lib/format";
import { navItem } from "@/lib/nav";
import {
  parseServiceView,
  SERVICE_TABS,
  serviceHref,
  TICKET_STATUS_LABEL,
  TICKET_TYPE_LABEL,
  type ServiceTab,
} from "@/lib/service-view";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listTickets } from "@/lib/services/tickets";

export const metadata: Metadata = { title: navItem("service").label };
const PER_PAGE = 50;

/** Service operations (PRD SV-1, SV-2): KPIs and the ticket list with live SLA clocks. */
export default async function ServicePage({ searchParams }: PageProps<"/service">) {
  const item = navItem("service");
  const view = parseServiceView(await searchParams);
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const db = await createClient();
  const r = await listTickets(db, activeOrg, {
    status: [...SERVICE_TABS[view.tab].statuses],
    sort: view.tab === "active" ? "sla_due_at" : "-created_at",
    limit: PER_PAGE,
    offset: (view.page - 1) * PER_PAGE,
  });
  const s = r.summary;
  const tiles: [string, string, string?][] = [
    ["Active tickets", String(s.active), s.awaiting_dispatch ? `${s.awaiting_dispatch} awaiting dispatch` : undefined],
    [
      "Median response",
      s.median_response_min === null ? "—" : `${Math.round(s.median_response_min)} min`,
      "Last 30 days",
    ],
    ["SLA compliance", formatPct(s.sla_compliance_30d, 0), "Last 30 days"],
    [
      "Service cost today",
      formatCents(s.cost_today_cents),
      `${formatCents(s.revenue_protected_today_cents)} revenue protected`,
    ],
  ];
  const chip = (on: boolean) =>
    cn(
      "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-label lg:min-h-8",
      on ? "border-fg bg-raised" : "border-divider hover:bg-raised",
    );
  const pages = Math.max(1, Math.ceil(r.total / PER_PAGE));
  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh orgId={activeOrg.id} />
      <PageHeader
        title={item.label}
        summary={item.summary}
        actions={activeOrg.isDemo ? <DataSourceBadge source="simulated" /> : null}
      />
      <section aria-label="Service KPIs">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-divider bg-divider lg:grid-cols-4">
          {tiles.map(([k, v, sub]) => (
            <div key={k} className="bg-surface p-4">
              <dt className="text-label text-fg-muted">{k}</dt>
              <dd className="text-display-s font-display font-semibold tabular-nums">{v}</dd>
              {sub ? <dd className="text-label text-fg-muted">{sub}</dd> : null}
            </div>
          ))}
        </dl>
      </section>
      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-2">
          {(Object.keys(SERVICE_TABS) as ServiceTab[]).map((t) => (
            <li key={t}>
              <Link
                href={serviceHref(t) as Route}
                aria-current={view.tab === t ? "true" : undefined}
                className={chip(view.tab === t)}
              >
                {SERVICE_TABS[t].label}
                {t === "active" ? <span className="tabular-nums">{s.active}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {r.items.length === 0 ? (
        <EmptyState
          icon={<Wrench aria-hidden="true" />}
          title={view.tab === "active" ? "No active tickets" : "No tickets here"}
          description={
            view.tab === "active"
              ? "Dispatch a vendor from an exception, or create a ticket from a vehicle's page."
              : "Nothing matches this filter yet."
          }
        >
          <Link href="/exceptions" className="underline underline-offset-4">
            Go to exceptions
          </Link>
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-md border border-divider">
          <table className="w-full min-w-[56rem] text-body">
            <caption className="sr-only">Service tickets</caption>
            <thead className="bg-surface text-left text-label text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Ticket
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Vehicle
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Vendor
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  SLA
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Cost
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Lost revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((t) => (
                <tr key={t.id} className="border-t border-divider hover:bg-raised">
                  <td className="px-3 py-2">
                    <Link
                      href={`/service/${t.number}` as Route}
                      className="font-mono text-mono underline-offset-4 hover:underline"
                    >
                      {t.number}
                    </Link>
                    <div className="text-label text-fg-muted">
                      {TICKET_TYPE_LABEL[t.type]} · {formatAge(t.created_at, r.asOf)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/fleet/${t.vehicle.number}` as Route} className="hover:underline">
                      {t.vehicle.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{TICKET_STATUS_LABEL[t.status]}</td>
                  <td className="px-3 py-2">{t.vendor?.name ?? <span className="text-fg-subtle">None yet</span>}</td>
                  <td className="px-3 py-2">
                    <SlaCountdown ticket={t} asOf={r.asOf} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.actual_cost_cents !== null ? (
                      formatCents(t.actual_cost_cents)
                    ) : t.estimated_cost_cents !== null ? (
                      <span className="text-fg-muted">~{formatCents(t.estimated_cost_cents)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCents(t.lost_revenue_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-label text-fg-muted">
          {view.page > 1 ? (
            <Link href={serviceHref(view.tab, view.page - 1) as Route} className="underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums">
            Page {view.page} of {pages}
          </span>
          {view.page < pages ? (
            <Link href={serviceHref(view.tab, view.page + 1) as Route} className="underline">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
