import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { SEVERITIES, type ExceptionStatus, type Severity } from "@fleetos/domain";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { SEVERITY_META, SeverityBadge } from "@fleetos/ui/components/severity-badge";
import { cn } from "@fleetos/ui/lib/cn";
import { AutoSubmitForm } from "@/components/fleet/auto-submit-form";
import { LiveRefresh } from "@/components/live/live-refresh";
import { PageHeader } from "@/components/shell/page-header";
import { ApiProblem } from "@/lib/api/problem";
import {
  CLASS_LABEL,
  EXCEPTION_VIEW_SORTS,
  exceptionsHref,
  parseExceptionsView,
  PER_PAGE,
  STATUS_TABS,
  type SearchParams,
  type StatusTab,
} from "@/lib/exceptions-view";
import { formatAge, formatCents, formatMinutes, formatWhen } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getException, listExceptions, type ExceptionOut } from "@/lib/services/exceptions";
import { ReportExceptionDialog } from "./report-exception-dialog";
import { ExceptionActions } from "./exception-actions";
import { ExceptionDispatch } from "./exception-dispatch";

export const STATUS_LABEL: Record<ExceptionStatus, string> = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  dismissed: "Dismissed",
};
const control = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const chip = (on: boolean) =>
  cn(
    "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-label lg:min-h-8",
    on ? "border-fg bg-raised" : "border-divider hover:bg-raised",
  );

/**
 * The exception queue (PRD EX-1, EX-3) and, when `selectedId` is set, one exception beside it (flows.md
 * `/exceptions/[id]`, shareable). Below 1024 px the selected exception replaces the list.
 */
export async function ExceptionsScreen({ sp, selectedId }: { sp: SearchParams; selectedId?: string }) {
  const item = navItem("exceptions");
  const view = parseExceptionsView(sp);
  const { user, activeOrg } = await getAppContext();
  if (!activeOrg || !user) return null;
  const db = await createClient();
  const now = new Date();
  const [list, selected, cars] = await Promise.all([
    listExceptions(
      db,
      activeOrg,
      {
        status: view.statuses,
        severity: view.severity,
        sort: EXCEPTION_VIEW_SORTS[view.sort].sort,
        limit: PER_PAGE,
        offset: (view.page - 1) * PER_PAGE,
      },
      now,
    ),
    selectedId
      ? getException(db, activeOrg, selectedId, now).catch((e) => {
          if (e instanceof ApiProblem && e.code === "not_found") notFound();
          throw e;
        })
      : Promise.resolve(null),
    db.from("vehicles").select("number").eq("org_id", activeOrg.id).neq("lifecycle", "retired").order("number"),
  ]);
  const canEdit = ["owner", "admin", "ops"].includes(activeOrg.role);
  const s = list.summary;
  const pages = Math.max(1, Math.ceil(list.total / PER_PAGE));
  const toggleSeverity = (sev: Severity) =>
    view.severity.includes(sev) ? view.severity.filter((x) => x !== sev) : [...view.severity, sev];

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh orgId={activeOrg.id} />
      <PageHeader
        title={item.label}
        summary={item.summary}
        actions={canEdit ? <ReportExceptionDialog vehicles={(cars.data ?? []).map((c) => c.number as string)} /> : null}
      />

      <section aria-label="Summary" className={cn(selected && "max-lg:hidden")}>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-divider bg-divider sm:grid-cols-4">
          <div className="bg-surface p-4">
            <dt className="text-label text-fg-muted">Active</dt>
            <dd className="text-display-s font-display font-semibold tabular-nums">{s.active}</dd>
          </div>
          <div className="bg-surface p-4">
            <dt className="text-label text-fg-muted">By severity</dt>
            <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
              {SEVERITIES.map((sev) => (
                <span key={sev} className="inline-flex items-center gap-1">
                  <span aria-hidden="true" className={SEVERITY_META[sev].className}>
                    {SEVERITY_META[sev].glyph}
                  </span>
                  {s.by_severity[sev]}
                  <span className="sr-only"> {SEVERITY_META[sev].label}</span>
                </span>
              ))}
            </dd>
          </div>
          <div className="bg-surface p-4">
            <dt className="text-label text-fg-muted">Resolved today</dt>
            <dd className="text-display-s font-display font-semibold tabular-nums">{s.resolved_today}</dd>
          </div>
          <div className="bg-surface p-4">
            <dt className="text-label text-fg-muted">Revenue at risk</dt>
            <dd className="text-display-s font-display font-semibold tabular-nums">
              {formatCents(s.revenue_at_risk_cents)}
            </dd>
          </div>
        </dl>
      </section>

      <div className={cn("grid gap-6", selected && "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]")}>
        <div className={cn("flex min-w-0 flex-col gap-4", selected && "max-lg:hidden")}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <nav aria-label="Filter by status">
              <ul className="flex flex-wrap gap-2">
                {(Object.keys(STATUS_TABS) as StatusTab[]).map((t) => (
                  <li key={t}>
                    <Link
                      href={exceptionsHref(view, { tab: t, page: 1 }) as Route}
                      aria-current={view.tab === t ? "true" : undefined}
                      className={chip(view.tab === t)}
                    >
                      {STATUS_TABS[t].label}
                      {t === "active" ? <span className="tabular-nums">{s.active}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <AutoSubmitForm method="get" action="/exceptions" className="flex items-end gap-2">
              {view.tab !== "active" ? <input type="hidden" name="status" value={view.tab} /> : null}
              {view.severity.length ? <input type="hidden" name="severity" value={view.severity.join(",")} /> : null}
              <label htmlFor="x-sort" className="text-label text-fg-muted">
                Sort
              </label>
              <select id="x-sort" name="sort" defaultValue={view.sort} className={control}>
                {Object.entries(EXCEPTION_VIEW_SORTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <noscript>
                <button type="submit" className={control}>
                  Sort
                </button>
              </noscript>
            </AutoSubmitForm>
          </div>
          <nav aria-label="Filter by severity">
            <ul className="flex flex-wrap gap-2">
              {SEVERITIES.map((sev) => {
                const on = view.severity.includes(sev);
                return (
                  <li key={sev}>
                    <Link
                      href={exceptionsHref(view, { severity: toggleSeverity(sev), page: 1 }) as Route}
                      aria-current={on ? "true" : undefined}
                      className={chip(on)}
                    >
                      <SeverityBadge severity={sev} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {list.items.length === 0 ? (
            <EmptyState
              icon={<CircleCheck aria-hidden="true" />}
              title={view.tab === "active" && !view.severity.length ? "Nothing needs attention" : "No exceptions here"}
              description={
                view.tab === "active"
                  ? `${s.resolved_today} resolved today. New problems appear here as soon as the rules detect them.`
                  : "Nothing matches these filters."
              }
            />
          ) : (
            <ul aria-label="Exceptions" className="flex flex-col gap-2">
              {list.items.map((e) => (
                <li key={e.id}>
                  <ExceptionRow
                    e={e}
                    href={exceptionsHref(view, {}, e.id)}
                    selected={e.id === selectedId}
                    now={list.asOf}
                  />
                </li>
              ))}
            </ul>
          )}
          {pages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between text-label text-fg-muted">
              {view.page > 1 ? (
                <Link href={exceptionsHref(view, { page: view.page - 1 }) as Route} className="underline">
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="tabular-nums">
                Page {view.page} of {pages}
              </span>
              {view.page < pages ? (
                <Link href={exceptionsHref(view, { page: view.page + 1 }) as Route} className="underline">
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>

        {selected ? (
          <ExceptionPanel
            e={selected}
            backHref={exceptionsHref(view)}
            canEdit={canEdit}
            userId={user.id}
            isDemo={activeOrg.isDemo}
            timeZone={activeOrg.timezone}
            now={list.asOf}
          />
        ) : null}
      </div>
    </div>
  );
}

function ExceptionRow({ e, href, selected, now }: { e: ExceptionOut; href: string; selected: boolean; now: number }) {
  return (
    <Link
      href={href as Route}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "grid gap-x-4 gap-y-1 rounded-md border bg-surface p-3 hover:bg-raised sm:grid-cols-[minmax(0,1fr)_auto]",
        selected ? "border-fg" : "border-divider",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <SeverityBadge severity={e.severity} />
        <span className="font-medium">{e.title}</span>
        {e.vehicle ? <span className="text-fg-muted">Car {e.vehicle.number}</span> : null}
        {e.blocks_service ? <span className="text-label text-fg-muted">· Out of service</span> : null}
      </div>
      <div className="text-right tabular-nums max-sm:text-left">
        {e.revenue_at_risk_cents !== null ? (
          <span>
            {formatCents(e.revenue_at_risk_cents)} <span className="text-label text-fg-muted">at risk</span>
          </span>
        ) : (
          <span className="text-label text-fg-muted">{STATUS_LABEL[e.status]}</span>
        )}
      </div>
      <p className="text-label text-fg-muted sm:col-span-2">
        {[
          e.location_name,
          formatAge(e.detected_at, now),
          e.recommended_action?.label,
          e.owner ? `Owner: ${e.owner.name}` : e.status === "open" ? "Unassigned" : null,
          e.status !== "open" && e.revenue_at_risk_cents !== null ? STATUS_LABEL[e.status] : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Link>
  );
}

function ExceptionPanel({
  e,
  backHref,
  canEdit,
  userId,
  isDemo,
  timeZone,
  now,
}: {
  e: Awaited<ReturnType<typeof getException>>;
  timeZone: string;
  backHref: string;
  canEdit: boolean;
  userId: string;
  isDemo: boolean;
  now: number;
}) {
  const facts: [string, React.ReactNode][] = [
    ["Status", STATUS_LABEL[e.status]],
    [
      "Vehicle",
      e.vehicle ? (
        <Link href={`/fleet/${encodeURIComponent(e.vehicle.number)}` as Route} className="underline underline-offset-4">
          Car {e.vehicle.number}
        </Link>
      ) : (
        "None"
      ),
    ],
    ["Kind", CLASS_LABEL[e.class]],
    ["Detected", formatWhen(e.detected_at, timeZone)],
    ["Where", e.location_name ?? "Unknown"],
    ["Takes car out of service", e.blocks_service ? "Yes" : "No"],
    ["Expected downtime", e.expected_downtime_min === null ? "—" : formatMinutes(e.expected_downtime_min)],
    ["Revenue at risk", formatCents(e.revenue_at_risk_cents)],
    ["Owner", e.owner ? (e.owner.user_id === userId ? "You" : e.owner.name) : "Unassigned"],
  ];
  const a = e.recommended_action;
  const trigger = e.trigger as { alert?: string | null; facts?: Record<string, unknown> } | null;
  return (
    <section
      aria-labelledby="exception-title"
      className="flex min-w-0 flex-col gap-5 self-start rounded-md border border-divider bg-surface p-4 lg:sticky lg:top-20"
    >
      <Link href={backHref as Route} className="self-start text-label text-fg-muted underline underline-offset-4">
        ← All exceptions
      </Link>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={e.severity} />
          {isDemo && e.rule_id ? <DataSourceBadge source="simulated" /> : null}
        </div>
        <h2 id="exception-title" className="text-title font-semibold">
          {e.title}
        </h2>
        {e.description ? <p className="text-fg-muted">{e.description}</p> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-label text-fg-muted">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {a ? (
        <div className="flex flex-col gap-1 rounded-sm border border-divider p-3">
          <h3 className="text-label font-semibold text-fg-muted">Recommended response</h3>
          <p className="font-medium">{a.label}</p>
          {a.eta_min !== null || a.cost_cents !== null ? (
            <p className="text-label text-fg-muted tabular-nums">
              {[
                a.eta_min !== null ? `ETA ${a.eta_min} min` : null,
                a.cost_cents !== null ? `about ${formatCents(a.cost_cents)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
      {e.ticket_id && e.ticket_number ? (
        <p className="rounded-sm border border-divider p-3">
          Handled by{" "}
          <Link
            href={`/service/${e.ticket_number}` as Route}
            className="font-mono text-mono underline underline-offset-4"
          >
            {e.ticket_number}
          </Link>
        </p>
      ) : canEdit && e.vehicle && (e.status === "open" || e.status === "assigned" || e.status === "in_progress") ? (
        <ExceptionDispatch
          exceptionId={e.id}
          vendor={
            a?.vendor_id && e.recommended_vendor_name ? { id: a.vendor_id, name: e.recommended_vendor_name } : null
          }
        />
      ) : null}
      {canEdit ? (
        <ExceptionActions
          key={e.id}
          id={e.id}
          status={e.status}
          ownedByMe={e.owner?.user_id === userId}
          hasOwner={!!e.owner}
        />
      ) : null}
      {trigger?.alert || trigger?.facts ? (
        <details className="text-label">
          <summary className="cursor-pointer font-medium">What triggered it</summary>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-fg-muted">
            {trigger.alert ? (
              <div className="col-span-2">
                <dt className="inline">Alert: </dt>
                <dd className="inline font-mono text-mono">{trigger.alert}</dd>
              </div>
            ) : null}
            {Object.entries(trigger.facts ?? {})
              .filter(([k, v]) => k !== "alerts" && v !== null)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="inline">{k.replaceAll("_", " ")}: </dt>
                  <dd className="inline tabular-nums">{typeof v === "number" ? Math.round(v * 10) / 10 : String(v)}</dd>
                </div>
              ))}
          </dl>
        </details>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 className="text-label font-semibold text-fg-muted">History</h3>
        <ol className="flex flex-col gap-2 border-l border-divider pl-3">
          {e.events.map((ev, i) => (
            <li key={i} className="text-label">
              <span className="text-fg">
                {ev.kind === "opened"
                  ? "Opened"
                  : ev.kind === "cleared"
                    ? "Condition cleared"
                    : ev.kind === "owner"
                      ? ev.note
                      : `${ev.from_status ? STATUS_LABEL[ev.from_status] : ""} → ${ev.to_status ? STATUS_LABEL[ev.to_status] : ""}`}
              </span>
              <span className="text-fg-muted">
                {" "}
                · {ev.actor ? (ev.actor.user_id === userId ? "You" : ev.actor.name) : "FleetOS"} ·{" "}
                {formatAge(ev.at, now)}
              </span>
              {ev.note && ev.kind !== "owner" && ev.kind !== "cleared" ? (
                <p className="text-fg-muted">“{ev.note}”</p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
