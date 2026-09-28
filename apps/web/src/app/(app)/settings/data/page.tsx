import type { Metadata } from "next";
import { capabilityStatuses, type Capability } from "@fleetos/domain";
import { cn } from "@fleetos/ui/lib/cn";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Settings · Data sources" };

/** Plain-language name, what it powers, and the realistic way to make it live (data-sources.md §5). */
const ABOUT: Record<Capability, { name: string; powers: string; connect: string }> = {
  tesla: {
    name: "Tesla vehicles",
    powers: "Live status, battery, location, alerts and telemetry",
    connect: "Connect Tesla Fleet API (coming with Phase 4: Settings → Integrations).",
  },
  rides: {
    name: "Rides",
    powers: "Trips, revenue miles, utilisation",
    connect: "No robotaxi trip API yet. Human-driven fleets can import Uber Fleet Portal exports.",
  },
  earnings: {
    name: "Earnings",
    powers: "Revenue per car and day",
    connect: "Import payout statements under Financials → Import payouts.",
  },
  cabin_events: {
    name: "Cabin camera events",
    powers: "Cleaning exceptions, cleanliness score",
    connect: "Tesla only, no third-party access yet. Report issues by hand from Exceptions.",
  },
  autonomy_events: {
    name: "Autonomy events",
    powers: "Incident-free rides score, incident exceptions",
    connect: "Tesla only, no third-party access yet.",
  },
  dispatch: {
    name: "Network dispatch",
    powers: "Taking cars off and back onto the robotaxi network",
    connect: "No API yet. FleetOS tells you what to change in the Tesla app.",
  },
  charger_telemetry: {
    name: "Charger telemetry",
    powers: "Exact charger occupancy at hubs",
    connect: "Depot chargers that speak OCPP can report status (not Superchargers). Estimated from cars until then.",
  },
  live_tariffs: {
    name: "Live electricity prices",
    powers: "Charging cost per session",
    connect: "Published utility rates (URDB) now; a live tariff feed (Arcadia) later. Set a price per hub under Hubs.",
  },
  vendor_tracking: {
    name: "Vendor tracking",
    powers: "Vendor ETA and arrival on tickets",
    connect: "Vendors with an API or job forms can report arrival; entered by hand on the ticket until then.",
  },
};

const STATE = {
  live: { glyph: "●", label: "Live", cls: "text-status-available" },
  simulated: { glyph: "◇", label: "Simulated", cls: "text-simulated" },
  unavailable: { glyph: "○", label: "Not connected", cls: "text-fg-subtle" },
} as const;

/** ST-5: every data source's state (the same registry as GET /api/v1/capabilities). */
export default async function DataSourcesPage() {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const caps = capabilityStatuses({ isDemo: activeOrg.isDemo });
  return (
    <section aria-labelledby="data" className="flex flex-col gap-4">
      <div>
        <h2 id="data" className="text-title font-semibold">
          Data sources
        </h2>
        <p className="text-label text-fg-muted">
          Where each kind of data comes from for this organization. Screens mark simulated data, and show a way to
          connect instead of a zero when a source isn&apos;t connected.
        </p>
      </div>
      <div
        className="overflow-x-auto rounded-md border border-divider"
        role="region"
        aria-labelledby="data"
        tabIndex={0}
      >
        <table className="w-full min-w-[44rem] text-body">
          <thead className="bg-raised text-left text-label text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Source
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                State
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Used for
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                How to connect
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {caps.map((c) => (
              <tr key={c.name}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {ABOUT[c.name].name}
                  <div className="font-mono text-mono text-fg-muted">{c.name}</div>
                </th>
                <td className="px-3 py-2">
                  <span className={cn("inline-flex items-center gap-1.5 text-label font-medium", STATE[c.state].cls)}>
                    <span aria-hidden="true">{STATE[c.state].glyph}</span>
                    {STATE[c.state].label}
                  </span>
                  {c.state === "unavailable" && c.fallback ? (
                    <div className="text-label text-fg-muted">
                      Meanwhile: {c.fallback === "csv" ? "CSV import" : c.fallback}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-label">{ABOUT[c.name].powers}</td>
                <td className="px-3 py-2 text-label text-fg-muted">{ABOUT[c.name].connect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
