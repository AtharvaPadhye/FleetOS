import type { Metadata, Route } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL, type VendorCategory } from "@fleetos/domain";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { cn } from "@fleetos/ui/lib/cn";
import { AutoSubmitForm } from "@/components/fleet/auto-submit-form";
import { PageHeader } from "@/components/shell/page-header";
import { VendorFormDialog } from "@/components/vendors/vendor-form-dialog";
import { VendorStatus } from "@/components/vendors/vendor-status";
import { ApiProblem } from "@/lib/api/problem";
import { formatCents, formatMiles, formatPct } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listVendors, rankForVehicle } from "@/lib/services/vendors";

export const metadata: Metadata = { title: navItem("vendors").label };

const isCategory = (c: unknown): c is VendorCategory => (VENDOR_CATEGORIES as readonly string[]).includes(String(c));
const control = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";

/** Vendor directory (PRD VN-1/2) with a "best vendor for this car" ranking (VN-4). */
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const item = navItem("vendors");
  const sp = await searchParams;
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const db = await createClient();
  const category = isCategory(sp.category) ? sp.category : undefined;
  const { vendors, counts, total } = await listVendors(db, activeOrg.id, category);
  const canEdit = ["owner", "admin", "ops"].includes(activeOrg.role);

  // Ranking panel: pick a car and a job type.
  const rankCategory = isCategory(sp.rank_category) ? sp.rank_category : "cleaning";
  const rankNumber = typeof sp.rank_vehicle === "string" ? sp.rank_vehicle : "";
  const { data: cars } = await db
    .from("vehicles")
    .select("id, number")
    .eq("org_id", activeOrg.id)
    .neq("lifecycle", "retired")
    .order("number")
    .limit(1000);
  let ranking: Awaited<ReturnType<typeof rankForVehicle>> | null = null;
  let rankError: string | null = null;
  const car = (cars ?? []).find((c) => c.number === rankNumber);
  if (car) {
    try {
      ranking = await rankForVehicle(db, activeOrg.id, car.id as string, rankCategory);
    } catch (e) {
      rankError = e instanceof ApiProblem ? e.message : "Couldn't rank vendors.";
    }
  }
  const chip = (on: boolean) =>
    cn(
      "inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-label lg:min-h-8",
      on ? "border-fg bg-raised" : "border-divider hover:bg-raised",
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={item.label} summary={item.summary} actions={canEdit ? <VendorFormDialog /> : null} />
      {total === 0 ? (
        <EmptyState
          icon={<Users aria-hidden="true" />}
          title="No vendors yet"
          description={
            canEdit
              ? "Add the cleaners, tow trucks, tyre and repair shops you work with. Service tickets dispatch to them."
              : "An owner, admin or ops user can add vendors."
          }
        >
          {canEdit ? <VendorFormDialog /> : null}
        </EmptyState>
      ) : (
        <>
          <nav aria-label="Filter by category">
            <ul className="flex flex-wrap gap-2">
              <li>
                <Link href="/vendors" aria-current={!category ? "true" : undefined} className={chip(!category)}>
                  All <span className="tabular-nums">{total}</span>
                </Link>
              </li>
              {VENDOR_CATEGORIES.filter((c) => counts[c] > 0).map((c) => (
                <li key={c}>
                  <Link
                    href={`/vendors?category=${c}` as Route}
                    aria-current={category === c ? "true" : undefined}
                    className={chip(category === c)}
                  >
                    {VENDOR_CATEGORY_LABEL[c]} <span className="tabular-nums">{counts[c]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section
            aria-labelledby="rank"
            className="flex flex-col gap-3 rounded-md border border-divider bg-surface p-4"
          >
            <h2 id="rank" className="text-title font-semibold">
              Best vendor for a car
            </h2>
            <AutoSubmitForm method="get" action="/vendors" className="flex flex-wrap items-end gap-3">
              {category ? <input type="hidden" name="category" value={category} /> : null}
              <div className="flex flex-col gap-1">
                <label htmlFor="rank_vehicle" className="text-label text-fg-muted">
                  Vehicle
                </label>
                <select id="rank_vehicle" name="rank_vehicle" defaultValue={rankNumber} className={control}>
                  <option value="">Pick a vehicle</option>
                  {(cars ?? []).map((c) => (
                    <option key={c.id as string} value={c.number as string}>
                      {c.number as string}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="rank_category" className="text-label text-fg-muted">
                  Job
                </label>
                <select id="rank_category" name="rank_category" defaultValue={rankCategory} className={control}>
                  {VENDOR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {VENDOR_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex h-11 items-center rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised lg:h-9"
              >
                Rank
              </button>
            </AutoSubmitForm>
            {rankError ? (
              <p role="alert" className="text-body text-severity-high">
                {rankError}
              </p>
            ) : ranking ? (
              ranking.length ? (
                <>
                  <ol
                    className="flex flex-col divide-y divide-divider"
                    aria-label={`Vendors for ${VENDOR_CATEGORY_LABEL[rankCategory].toLowerCase()} on car ${rankNumber}, best first`}
                  >
                    {ranking.map((r, i) => (
                      <li key={r.vendor.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                        <span className="flex items-baseline gap-2">
                          <span className="w-5 text-fg-subtle tabular-nums">{i + 1}.</span>
                          <Link href={`/vendors/${r.vendor.slug}` as Route} className="font-medium hover:underline">
                            {r.vendor.name}
                          </Link>
                          {r.breakdown.limited_penalty ? <VendorStatus status="limited" /> : null}
                        </span>
                        <span className="text-label text-fg-muted tabular-nums">
                          Score <span className="font-semibold text-fg">{r.score.toFixed(2)}</span> · ETA{" "}
                          {r.expected_eta_min ?? "—"} min ({(r.breakdown.eta * 100).toFixed(0)}) ·{" "}
                          {r.expected_cost_cents !== null ? formatCents(r.expected_cost_cents) : "no price"} (
                          {(r.breakdown.cost * 100).toFixed(0)}) · SLA {formatPct(r.sla_compliance, 0)} (
                          {(r.breakdown.sla * 100).toFixed(0)})
                          {r.distance_m !== null ? ` · ${formatMiles(r.distance_m, 1)} away` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="text-label text-fg-muted">
                    Numbers in brackets are each part&apos;s score out of 100 (ETA 50%, price 30%, SLA 20%).
                  </p>
                </>
              ) : (
                <p className="text-body text-fg-muted">
                  No vendor for {VENDOR_CATEGORY_LABEL[rankCategory].toLowerCase()} covers car {rankNumber}&apos;s
                  location.
                </p>
              )
            ) : (
              <p className="text-label text-fg-muted">
                Score = 50% ETA + 30% price + 20% SLA record, relative to the other vendors covering the car; limited
                vendors × 0.8. New vendors get a 90% SLA prior until they have 5 jobs.
              </p>
            )}
          </section>

          <section aria-labelledby="directory" className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <h2 id="directory" className="text-title font-semibold">
                {category ? VENDOR_CATEGORY_LABEL[category] : "All vendors"}
              </h2>
              {activeOrg.isDemo ? <DataSourceBadge source="simulated" /> : null}
            </div>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {vendors.map((v) => (
                <li key={v.id} className="flex flex-col gap-3 rounded-md border border-divider bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">
                        <Link href={`/vendors/${v.slug}` as Route} className="hover:underline">
                          {v.name}
                        </Link>
                      </h3>
                      <p className="text-label text-fg-muted">
                        {v.categories.map((c) => VENDOR_CATEGORY_LABEL[c]).join(" · ")}
                      </p>
                    </div>
                    <VendorStatus status={v.status} />
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-label">
                    <div>
                      <dt className="text-fg-muted">Radius</dt>
                      <dd className="text-body tabular-nums">
                        {v.service_radius_m ? formatMiles(v.service_radius_m) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Typical job</dt>
                      <dd className="text-body tabular-nums">
                        {Object.values(v.pricing).length ? formatCents(Math.min(...Object.values(v.pricing))) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Response SLA</dt>
                      <dd className="text-body tabular-nums">
                        {v.sla_response_min ? `${v.sla_response_min} min` : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">SLA met</dt>
                      <dd className="text-body tabular-nums">{formatPct(v.metrics.sla_compliance, 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Jobs</dt>
                      <dd className="text-body tabular-nums">{v.metrics.jobs_completed}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Capacity</dt>
                      <dd className="text-body">{v.capacity_note ?? "—"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
