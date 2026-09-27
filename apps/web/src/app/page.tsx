import type { Metadata } from "next";
import { Button } from "@fleetos/ui/components/button";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { SeverityBadge, type Severity } from "@fleetos/ui/components/severity-badge";
import { StatusBadge, STATUS_META, type VehicleStatus } from "@fleetos/ui/components/status-badge";

export const metadata: Metadata = { title: "Foundation" };

const statuses = Object.keys(STATUS_META) as VehicleStatus[];
const severities: Severity[] = ["critical", "high", "medium", "low"];

// Sample figures from the MVP's Overview (docs/requirements/kpis.md §6 E2), shown to preview the type scale.
// SUBSTITUTE(earnings, fixture): hard-coded demo revenue figures on the foundation preview page.
//   Real source: GET /api/v1/kpis/fleet backed by the simulator (task 3.8) and later the Tesla provider (Phase 4).
//   Replace by: delete this preview when the app shell and Overview land (tasks 2.5 and 5.3).
//   Docs: docs/requirements/data-sources.md §4.2
const moneyStrip = [
  { label: "Revenue today", value: "$18,420" },
  { label: "Contribution", value: "$9,860", note: "53.5% margin" },
  { label: "Revenue at risk", value: "−$590", loss: true },
];

export default function FoundationPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-label font-semibold tracking-[0.06em] text-fg-muted uppercase">FleetOS · foundation</p>
        <h1 className="font-display text-display-l font-semibold [font-stretch:112.5%]">
          Operations control tower for autonomous fleets
        </h1>
        <p className="max-w-2xl text-fg-muted">
          This page previews the design system while the app is being built. The app shell arrives in task 2.5; live
          data arrives with the simulator in Phase 3.
        </p>
        <div>
          <DataSourceBadge source="simulated" />
        </div>
      </header>

      <section aria-labelledby="money-heading" className="rounded-md border border-divider bg-surface p-6">
        <h2 id="money-heading" className="mb-4 text-title font-semibold">
          Money strip
        </h2>
        <dl className="grid gap-6 sm:grid-cols-3">
          {moneyStrip.map((item) => (
            <div key={item.label} className="flex flex-col gap-1">
              <dt className="text-label text-fg-muted">{item.label}</dt>
              <dd
                className={`font-display text-display-xl font-semibold [font-stretch:112.5%] ${item.loss ? "text-money-loss" : ""}`}
              >
                {item.value}
              </dd>
              {item.note ? <dd className="text-label text-fg-subtle">{item.note}</dd> : null}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="status-heading" className="flex flex-col gap-4">
        <h2 id="status-heading" className="text-title font-semibold">
          Vehicle status and severity
        </h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {statuses.map((s) => (
            <li key={s}>
              <StatusBadge status={s} />
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-x-6 gap-y-2">
          {severities.map((s) => (
            <li key={s}>
              <SeverityBadge severity={s} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="actions-heading" className="flex flex-col gap-4">
        <h2 id="actions-heading" className="text-title font-semibold">
          Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Dispatch cleaner</Button>
          <Button variant="secondary">Pull from service</Button>
          <Button variant="ghost">View timeline</Button>
          <Button variant="danger">Cancel ticket</Button>
        </div>
        <p className="font-mono text-mono text-fg-muted">VIN 7G2CEHED8RA004047 · SVC-2026-1847 · 09:42:17</p>
      </section>
    </main>
  );
}
