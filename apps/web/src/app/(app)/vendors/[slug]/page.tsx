import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VENDOR_CATEGORY_LABEL } from "@fleetos/domain";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { VehicleMap } from "@/components/vehicle/vehicle-map";
import { VendorFormDialog } from "@/components/vendors/vendor-form-dialog";
import { VendorStatus } from "@/components/vendors/vendor-status";
import { ApiProblem } from "@/lib/api/problem";
import { formatCents, formatMiles, formatPct } from "@/lib/format";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getVendor } from "@/lib/services/vendors";

export async function generateMetadata({ params }: PageProps<"/vendors/[slug]">): Promise<Metadata> {
  return { title: `Vendor · ${(await params).slug}` };
}

/** Vendor page (PRD VN-5): terms, service area, and performance from completed jobs. */
export default async function VendorPage({ params }: PageProps<"/vendors/[slug]">) {
  const { slug } = await params;
  const { activeOrg } = await getAppContext();
  if (!activeOrg) notFound();
  let v;
  try {
    v = await getVendor(await createClient(), activeOrg.id, { slug });
  } catch (e) {
    if (e instanceof ApiProblem && e.code === "not_found") notFound();
    throw e;
  }
  const canEdit = ["owner", "admin", "ops"].includes(activeOrg.role);
  const facts: [string, string][] = [
    ["Categories", v.categories.map((c) => VENDOR_CATEGORY_LABEL[c]).join(", ")],
    ["Service radius", v.service_radius_m ? formatMiles(v.service_radius_m) : "Not set"],
    ["Response SLA", v.sla_response_min ? `${v.sla_response_min} min` : "Not set"],
    ["Resolution SLA", v.sla_resolution_min ? `${v.sla_resolution_min} min` : "Not set"],
    ["Contact", [v.contact.name, v.contact.phone, v.contact.email].filter(Boolean).join(" · ") || "Not set"],
    ["Capacity", v.capacity_note ?? "—"],
  ];
  return (
    <div className="flex flex-col gap-6">
      <Link href="/vendors" className="self-start text-label text-fg-muted underline underline-offset-4">
        ← Vendors
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            id="main-heading"
            tabIndex={-1}
            className="font-display text-display-l font-semibold [font-stretch:112.5%] focus:outline-none"
          >
            {v.name}
          </h1>
          <VendorStatus status={v.status} className="text-body" />
          {activeOrg.isDemo ? <DataSourceBadge source="simulated" /> : null}
        </div>
        {canEdit ? <VendorFormDialog vendor={v} /> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-divider bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
        {facts.map(([k, val]) => (
          <div key={k}>
            <dt className="text-label text-fg-muted">{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section aria-labelledby="area" className="flex flex-col gap-3">
          <h2 id="area" className="text-title font-semibold">
            Service area
          </h2>
          <VehicleMap
            vehicle={null}
            glyph=""
            hub={
              v.base_location && v.service_radius_m
                ? { ...v.base_location, radiusM: v.service_radius_m, name: v.name }
                : null
            }
            areaLabel={`${v.name} base`}
            label={
              v.base_location
                ? `Map of ${v.name}'s service area: ${v.service_radius_m ? formatMiles(v.service_radius_m) : "no"} radius around its base`
                : "No base location"
            }
          />
        </section>
        <section aria-labelledby="prices" className="flex flex-col gap-3">
          <h2 id="prices" className="text-title font-semibold">
            Prices and performance
          </h2>
          <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
            {Object.entries(v.pricing).map(([c, cents]) => (
              <li key={c} className="flex justify-between px-4 py-2">
                <span>{VENDOR_CATEGORY_LABEL[c as keyof typeof VENDOR_CATEGORY_LABEL] ?? c}</span>
                <span className="tabular-nums">{formatCents(cents, { decimals: true })}</span>
              </li>
            ))}
            <li className="flex justify-between px-4 py-2">
              <span>SLA met</span>
              <span className="tabular-nums">{formatPct(v.metrics.sla_compliance, 0)}</span>
            </li>
            <li className="flex justify-between px-4 py-2">
              <span>Average response</span>
              <span className="tabular-nums">
                {v.metrics.avg_response_min !== null ? `${Math.round(v.metrics.avg_response_min)} min` : "—"}
              </span>
            </li>
            <li className="flex justify-between px-4 py-2">
              <span>Jobs completed</span>
              <span className="tabular-nums">{v.metrics.jobs_completed}</span>
            </li>
          </ul>
          {v.metrics.jobs_completed === 0 ? (
            <p className="text-label text-fg-muted">
              No jobs yet. Response times, SLA record and cost trends fill in as service tickets are dispatched to this
              vendor.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
