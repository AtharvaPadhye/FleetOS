import type { Metadata, Route } from "next";
import Link from "next/link";
import { CarFront, Download, SearchX } from "lucide-react";
import { VEHICLE_STATUSES } from "@fleetos/domain";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { StatusBadge } from "@fleetos/ui/components/status-badge";
import { cn } from "@fleetos/ui/lib/cn";
import { AddVehicleDialog } from "@/components/fleet/add-vehicle-dialog";
import { AutoSubmitForm } from "@/components/fleet/auto-submit-form";
import { ColumnChooser } from "@/components/fleet/column-chooser";
import { FilterDisclosure } from "@/components/fleet/filter-disclosure";
import { FleetRow } from "@/components/fleet/fleet-row";
import { LiveRefresh } from "@/components/live/live-refresh";
import { PageHeader } from "@/components/shell/page-header";
import { ApiProblem } from "@/lib/api/problem";
import {
  FLEET_COLUMNS,
  PAGE_SIZES,
  SOC_BANDS,
  fleetHref,
  isFiltered,
  parseFleetView,
  sortHref,
  toggleStatusHref,
  visibleColumns,
  type FleetColumnKey,
  type SearchParams,
} from "@/lib/fleet-view";
import { formatAge, formatCents, formatMinutes } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listFleet, type FleetItem } from "@/lib/services/fleet";

export const metadata: Metadata = { title: navItem("fleet").label };

const PROFIT = {
  strong: { glyph: "▲", label: "Strong", cls: "text-status-available" },
  monitor: { glyph: "●", label: "Monitor", cls: "text-fg-muted" },
  review: { glyph: "▼", label: "Review", cls: "text-severity-high" },
} as const;

const control = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";

export default async function FleetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const item = navItem("fleet");
  const view = parseFleetView(await searchParams);
  const { activeOrg, user } = await getAppContext();
  if (!activeOrg || !user) return null;
  const supabase = await createClient();

  const band = view.soc ? SOC_BANDS[view.soc] : null;
  let result: Awaited<ReturnType<typeof listFleet>> | null = null;
  let error: string | null = null;
  try {
    result = await listFleet(supabase, activeOrg, {
      status: view.status,
      hub_id: view.hub ?? undefined,
      soc_lt: band && "soc_lt" in band ? band.soc_lt : undefined,
      soc_gte: band && "soc_gte" in band ? band.soc_gte : undefined,
      q: view.q || undefined,
      profitability: view.profitability ?? undefined,
      sort: view.sort,
      limit: view.per,
      offset: (view.page - 1) * view.per,
    });
  } catch (e) {
    error = e instanceof ApiProblem ? e.message : "Something went wrong loading the fleet.";
  }
  const { data: profile } = await supabase.from("profiles").select("preferences").eq("user_id", user.id).maybeSingle();
  const prefs = (profile?.preferences as { fleet?: { columns?: string[]; density?: string } } | null)?.fleet ?? {};
  const canSeeMoney = result?.canSeeMoney ?? false;
  const columns = visibleColumns(prefs.columns, canSeeMoney);
  const density = prefs.density === "compact" ? "compact" : "default";
  const canAdd = activeOrg.role === "owner" || activeOrg.role === "admin";
  const now = result?.asOf ?? 0;

  const exportHref = `/fleet/export.csv${fleetHref(view, { page: 1 }).replace(/^\/fleet/, "")}`;
  const totalVehicles = result?.fleetSize ?? 0;
  const from = result && result.total ? (view.page - 1) * view.per + 1 : 0;
  const to = result ? Math.min(view.page * view.per, result.total) : 0;
  const cell = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh orgId={activeOrg.id} />
      <PageHeader
        title={item.label}
        summary={item.summary}
        actions={
          <>
            {result && totalVehicles > 0 ? (
              <a
                href={exportHref}
                className="inline-flex h-9 items-center gap-2 rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised [&_svg]:size-4"
              >
                <Download aria-hidden="true" /> Export CSV
              </a>
            ) : null}
            {canAdd && result ? <AddVehicleDialog hubs={result.hubs} /> : null}
          </>
        }
      />

      {error ? (
        <p role="alert" className="rounded-md border border-severity-high p-6 text-body">
          Couldn&apos;t load vehicles: {error}{" "}
          <Link href={fleetHref(view) as Route} className="underline underline-offset-4">
            Retry
          </Link>
        </p>
      ) : result && totalVehicles === 0 && !isFiltered(view) ? (
        <EmptyState
          icon={<CarFront aria-hidden="true" />}
          title="No vehicles yet"
          description={
            canAdd
              ? "Add your first vehicle by VIN. Connecting Tesla (coming soon) will add them automatically."
              : "An owner or admin can add vehicles to this fleet."
          }
        >
          {canAdd ? <AddVehicleDialog hubs={result.hubs} /> : null}
        </EmptyState>
      ) : result ? (
        <>
          <section aria-labelledby="fleet-status" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="fleet-status" className="text-title font-semibold">
                {totalVehicles} vehicles
              </h2>
              {activeOrg.isDemo ? <DataSourceBadge source="simulated" /> : null}
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Filter by status">
              {VEHICLE_STATUSES.map((s) => {
                const on = view.status.includes(s);
                return (
                  <li key={s}>
                    <Link
                      href={toggleStatusHref(view, s) as Route}
                      aria-current={on ? "true" : undefined}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-label lg:min-h-8",
                        on ? "border-fg bg-raised" : "border-divider hover:bg-raised",
                      )}
                    >
                      <StatusBadge status={s} />
                      <span className="text-fg tabular-nums">{result.statusCounts[s]}</span>
                      {on ? <span className="sr-only">(filter on)</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <FilterDisclosure active={[view.hub, view.soc, view.profitability, view.q].filter(Boolean).length}>
            <AutoSubmitForm
              method="get"
              action="/fleet"
              role="search"
              aria-label="Filter vehicles"
              className="flex flex-wrap items-end gap-3"
            >
              {view.status.length ? <input type="hidden" name="status" value={view.status.join(",")} /> : null}
              {view.sort !== "number" ? <input type="hidden" name="sort" value={view.sort} /> : null}
              <div className="flex flex-col gap-1">
                <label htmlFor="q" className="text-label text-fg-muted">
                  Search
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={view.q}
                  placeholder="Number, VIN or name"
                  className={cn(control, "w-56")}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="hub" className="text-label text-fg-muted">
                  Home hub
                </label>
                <select id="hub" name="hub" defaultValue={view.hub ?? ""} className={control}>
                  <option value="">All hubs</option>
                  {result.hubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="soc" className="text-label text-fg-muted">
                  Battery
                </label>
                <select id="soc" name="soc" defaultValue={view.soc ?? ""} className={control}>
                  <option value="">Any level</option>
                  {Object.entries(SOC_BANDS).map(([k, b]) => (
                    <option key={k} value={k}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              {canSeeMoney ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor="profitability" className="text-label text-fg-muted">
                    30-day performance
                  </label>
                  <select
                    id="profitability"
                    name="profitability"
                    defaultValue={view.profitability ?? ""}
                    className={control}
                  >
                    <option value="">Any</option>
                    <option value="review">Review</option>
                    <option value="monitor">Monitor</option>
                    <option value="strong">Strong</option>
                  </select>
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <label htmlFor="per" className="text-label text-fg-muted">
                  Per page
                </label>
                <select id="per" name="per" defaultValue={String(view.per)} className={control}>
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised lg:h-9"
              >
                Apply
              </button>
              {isFiltered(view) ? (
                <Link
                  href="/fleet"
                  className="inline-flex h-11 items-center px-2 text-body text-fg-muted underline underline-offset-4 lg:h-9"
                >
                  Clear filters
                </Link>
              ) : null}
            </AutoSubmitForm>
          </FilterDisclosure>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body text-fg-muted" aria-live="polite">
              {result.total ? `Showing ${from}–${to} of ${result.total}` : "No vehicles match these filters"}
            </p>
            <ColumnChooser visible={columns} density={density} canSeeMoney={canSeeMoney} />
          </div>

          {result.total === 0 ? (
            <EmptyState
              icon={<SearchX aria-hidden="true" />}
              title="No vehicles match"
              description="Try another status, hub or battery level, or clear the filters."
            >
              <Link href="/fleet" className="text-body underline underline-offset-4">
                Clear filters
              </Link>
            </EmptyState>
          ) : (
            <div
              className="overflow-x-auto rounded-md border border-divider"
              role="region"
              aria-labelledby="fleet-table-caption"
              tabIndex={0}
            >
              <table className="w-full min-w-[48rem] border-collapse text-body">
                <caption id="fleet-table-caption" className="sr-only">
                  Vehicles, {result.total} matching, sorted by {view.sort.replace(/^-/, "").replaceAll("_", " ")}
                  {view.sort.startsWith("-") ? " descending" : " ascending"}
                </caption>
                <thead className="border-b border-divider bg-raised">
                  <tr>
                    <SortHeader view={view} field="number" label="Vehicle" sticky />
                    {FLEET_COLUMNS.filter((c) => columns.includes(c.key)).map((c) =>
                      "sort" in c ? (
                        <SortHeader key={c.key} view={view} field={c.sort} label={c.label} numeric={"numeric" in c} />
                      ) : (
                        <th
                          key={c.key}
                          scope="col"
                          className="px-3 py-2 text-left text-label font-medium whitespace-nowrap text-fg-muted"
                        >
                          {c.label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {result.items.map((v) => (
                    <FleetRow key={v.id} href={`/fleet/${v.number}`} className="group cursor-pointer hover:bg-raised">
                      <th
                        scope="row"
                        className={cn(cell, "sticky left-0 bg-canvas text-left font-normal group-hover:bg-raised")}
                      >
                        <Link
                          href={`/fleet/${v.number}` as Route}
                          className="font-mono text-mono font-medium hover:underline"
                        >
                          {v.number}
                        </Link>
                        {v.display_name && v.display_name !== `Cybercab ${v.number}` ? (
                          <span className="ml-2 text-label text-fg-muted">{v.display_name}</span>
                        ) : null}
                      </th>
                      {columns.map((k) => (
                        <td
                          key={k}
                          className={cn(cell, isNumeric(k) && "text-right tabular-nums", "whitespace-nowrap")}
                        >
                          <Cell k={k} v={v} lowSoc={result.lowSocThreshold} now={now} />
                        </td>
                      ))}
                    </FleetRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.total > view.per ? (
            <nav aria-label="Pages" className="flex items-center justify-between gap-2">
              <PageLink href={fleetHref(view, { page: view.page - 1 })} disabled={view.page <= 1} label="Previous" />
              <span className="text-body text-fg-muted">
                Page {view.page} of {Math.ceil(result.total / view.per)}
              </span>
              <PageLink
                href={fleetHref(view, { page: view.page + 1 })}
                disabled={view.page * view.per >= result.total}
                label="Next"
              />
            </nav>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const isNumeric = (k: FleetColumnKey) => FLEET_COLUMNS.some((c) => c.key === k && "numeric" in c);

function SortHeader({
  view,
  field,
  label,
  numeric = false,
  sticky = false,
}: {
  view: ReturnType<typeof parseFleetView>;
  field: Parameters<typeof sortHref>[1];
  label: string;
  numeric?: boolean;
  sticky?: boolean;
}) {
  const active = view.sort.replace(/^-/, "") === field;
  const desc = view.sort.startsWith("-");
  return (
    <th
      scope="col"
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      className={cn(
        "px-3 py-2 text-label font-medium whitespace-nowrap",
        numeric ? "text-right" : "text-left",
        sticky && "sticky left-0 z-10 bg-raised",
      )}
    >
      <Link
        href={sortHref(view, field, numeric) as Route}
        className={cn("inline-flex min-h-8 items-center gap-1 hover:text-fg", active ? "text-fg" : "text-fg-muted")}
      >
        {label}
        <span aria-hidden="true" className="text-fg-subtle">
          {active ? (desc ? "↓" : "↑") : "↕"}
        </span>
      </Link>
    </th>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  return disabled ? (
    <span aria-disabled="true" className="inline-flex h-11 items-center px-4 text-body text-fg-subtle lg:h-9">
      {label}
    </span>
  ) : (
    <Link
      href={href as Route}
      className="inline-flex h-11 items-center rounded-sm border border-border-control px-4 text-body hover:bg-raised lg:h-9"
    >
      {label}
    </Link>
  );
}

function Cell({ k, v, lowSoc, now }: { k: FleetColumnKey; v: FleetItem; lowSoc: number; now: number }) {
  switch (k) {
    case "status":
      return <StatusBadge status={v.state.status} />;
    case "soc": {
      const soc = v.state.soc;
      if (soc === null) return <span className="text-fg-subtle">—</span>;
      const low = v.state.fresh && soc < lowSoc;
      return (
        <span className={cn(low && "text-status-maintenance")}>
          {low ? (
            <span aria-hidden="true" className="mr-1">
              ◆
            </span>
          ) : null}
          {Math.round(soc * 100)}%{low ? <span className="sr-only"> (low)</span> : null}
        </span>
      );
    }
    case "location":
      return v.location_name ? <span>{v.location_name}</span> : <span className="text-fg-subtle">Unknown</span>;
    case "hub":
      return v.home_hub ? <span>{v.home_hub.name}</span> : <span className="text-fg-subtle">—</span>;
    case "revenue":
      return <Money cents={v.today.revenue_cents} />;
    case "contribution":
      return <Money cents={v.today.contribution_cents} signed />;
    case "rph":
      return <Money cents={v.today.revenue_per_available_hour_cents} decimals />;
    case "downtime":
      return (
        <span className={cn(v.today.downtime_min === 0 && "text-fg-subtle")}>
          {formatMinutes(v.today.downtime_min)}
        </span>
      );
    case "profitability": {
      if (!v.profitability)
        return (
          <span className="text-fg-subtle" title="Not enough history yet">
            —
          </span>
        );
      const p = PROFIT[v.profitability];
      return (
        <span className={cn("inline-flex items-center gap-1.5 text-label font-medium", p.cls)}>
          <span aria-hidden="true">{p.glyph}</span>
          {p.label}
        </span>
      );
    }
    case "updated": {
      const age = formatAge(v.state.last_telemetry_at, now);
      if (v.state.fresh)
        return <span className="text-fg-muted">{v.state.connectivity === "online" ? "Live" : age}</span>;
      return (
        <span
          className="inline-flex items-center gap-1.5 text-status-maintenance"
          title="No data in the last 5 minutes"
        >
          <span aria-hidden="true">◆</span>
          Stale · {age}
        </span>
      );
    }
  }
}

function Money({
  cents,
  signed = false,
  decimals = false,
}: {
  cents: number | null;
  signed?: boolean;
  decimals?: boolean;
}) {
  if (cents === null) return <span className="text-fg-subtle">—</span>;
  return (
    <span className={cn(cents === 0 && "text-fg-subtle")}>
      {formatCents(cents, { decimals: decimals || Math.abs(cents) < 100_00, signed: signed && cents !== 0 })}
    </span>
  );
}
