import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  assetHealthGrade,
  availability,
  covenantStatus,
  deriveStatus,
  economicNetCents,
  expectedRemainingDowntimeHours,
  hourTotals,
  incidentImpact,
  pnl,
  revenueAtRiskCents,
  revenueRecoveredCents,
  statusHours,
  uptime,
  type LedgerCategory,
  type StatusInputs,
  type VehicleStatus,
} from "@fleetos/domain";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { StatusBadge } from "@fleetos/ui/components/status-badge";
import { formatCents, formatHours, formatPct, formatRatePerHour } from "@/lib/format";

export const metadata: Metadata = { title: "Rulebook" };

/*
 * Reference page: runs the real rulebook (packages/domain, task 3.1) on the worked examples in
 * docs/requirements/kpis.md §6. These inputs are intentional documentation examples, not stand-ins for a
 * live source, so they carry no SUBSTITUTE marker.
 */

// ---------- 1. Status rules ----------
const NOW = new Date("2026-09-26T10:00:00-07:00");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const BASE: StatusInputs = {
  now: NOW,
  lastTelemetryAt: minutesAgo(0.5),
  telemetryMode: "streaming",
  connectivity: "online",
  insideHub: false,
  soc: 0.7,
  socMin: 0.4,
  chargeTarget: 0.8,
  chargeState: "disconnected",
  pluggedIn: false,
  chargeTaskToHub: false,
  blockingIncident: false,
  blockingMaintenance: false,
  manualHold: false,
  teslaServiceMode: false,
  blockingCleaning: false,
  platformOnTrip: null,
};
const SCENARIOS: { car: string; situation: string; inputs: Partial<StatusInputs> }[] = [
  { car: "031", situation: "Driving near Sky Harbor, 68% battery", inputs: {} },
  { car: "063", situation: "Parked at Tempe Hub, 91% battery", inputs: { insideHub: true, soc: 0.91 } },
  { car: "082", situation: "At Downtown Hub with 23% battery, not plugged in", inputs: { insideHub: true, soc: 0.23 } },
  {
    car: "026",
    situation: "Plugged in at a hub at 60%, charge target 80%",
    inputs: { insideHub: true, pluggedIn: true, soc: 0.6, chargeState: "stopped" },
  },
  { car: "047", situation: "Cabin spill ticket open (policy CLN-02)", inputs: { blockingCleaning: true } },
  { car: "019", situation: "Recurring fault, pulled for diagnostics", inputs: { blockingMaintenance: true } },
  {
    car: "052",
    situation: "Broken down on I-10, tow assigned, no signal for 3 h",
    inputs: { blockingIncident: true, lastTelemetryAt: minutesAgo(180) },
  },
  {
    car: "071",
    situation: "Asleep at its hub, no data for 2 h",
    inputs: { connectivity: "asleep", insideHub: true, lastTelemetryAt: minutesAgo(120) },
  },
  { car: "090", situation: "No data for 20 min, away from any hub", inputs: { lastTelemetryAt: minutesAgo(20) } },
];

// ---------- 2. A day for car 047 ----------
const at = (hhmm: string) => new Date(`2026-09-26T${hhmm}:00-07:00`);
const DAY: { time: string; to: VehicleStatus; what: string }[] = [
  { time: "00:00", to: "ready", what: "Parked at Downtown Hub overnight" },
  { time: "06:14", to: "in_service", what: "Entered service" },
  { time: "09:43", to: "cleaning", what: "Cabin spill detected; removed from service (CLN-02)" },
  { time: "10:29", to: "in_service", what: "Cleaned and returned to service" },
];
const WINDOW = { start: at("06:00"), end: at("12:00") };
const dayHours = statusHours(
  DAY.map((d) => ({ at: at(d.time), to: d.to })),
  WINDOW,
);
const dayTotals = hourTotals(dayHours);

// ---------- 3. Car 047 P&L ----------
const LINES: { category: LedgerCategory; label: string; dollars: number }[] = [
  { category: "gross_ride_revenue", label: "Gross revenue", dollars: 7_940 },
  { category: "platform_fee", label: "Platform fees", dollars: 1_588 },
  { category: "electricity", label: "Electricity", dollars: 672 },
  { category: "cleaning", label: "Cleaning", dollars: 486 },
  { category: "maintenance", label: "Maintenance", dollars: 694 },
  { category: "insurance", label: "Insurance", dollars: 486 },
  { category: "financing", label: "Financing", dollars: 1_143 },
];
const statement = pnl(LINES.map((l) => ({ category: l.category, amountCents: l.dollars * 100 })));
const DOWNTIME_COST = 74_100;

// ---------- 4 & 5. Revenue at risk / incident cost ----------
const RATE_052 = 2_312;
const remaining052 = expectedRemainingDowntimeHours({
  vendorEtaHours: 0.3,
  medianServiceHours: 5.2,
  medianResolutionHours: 9,
});
const atRisk052 = revenueAtRiskCents(remaining052, RATE_052);
const RATE_047 = 4_098;
const spill = incidentImpact({ downtimeMinutes: 47, rateCentsPerHour: RATE_047, serviceCostCents: 1_800 });
const recovered = revenueRecoveredCents({ slaTargetMinutes: 60, actualMinutes: 47, rateCentsPerHour: RATE_047 });

// ---------- 6. Lender grade ----------
const AUGUST = {
  uptime: 0.972,
  uptimeCovenant: 0.94,
  contributionMargin: 0.541,
  marginTarget: 0.5,
  reserveFunded: 1.18,
  incidentsPer10k: 2.1,
  incidentTargetPer10k: 2.5,
  vendorSla: 0.93,
};
const grade = assetHealthGrade(AUGUST);
const COVENANTS = [
  { label: "Fleet uptime > 94%", value: 0.972 },
  { label: "Fleet uptime > 94% (a tight month)", value: 0.946 },
  { label: "Fleet uptime > 94% (a bad month)", value: 0.921 },
].map((c) => ({ ...c, status: covenantStatus(c.value, ">", 0.94) }));
const COVENANT_TEXT = { pass: "Pass", at_risk: "At risk", breach: "Breach", not_tracked: "Not tracked" } as const;

// ---------- presentation ----------
function Section({ id, title, rule, children }: { id: string; title: string; rule: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-md border border-divider bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-title font-semibold">
          {title}
        </h2>
        <p className="text-fg-muted">{rule}</p>
      </div>
      {children}
    </section>
  );
}

function Result({ label, value, tone }: { label: string; value: string; tone?: "loss" | "gain" }) {
  const color = tone === "loss" ? "text-money-loss" : tone === "gain" ? "text-money-gain" : "";
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label text-fg-muted">{label}</dt>
      <dd className={`font-display text-display-l font-semibold [font-stretch:112.5%] ${color}`}>{value}</dd>
    </div>
  );
}

const th = "py-2 pr-4 text-left text-label font-medium text-fg-muted";
const td = "py-2 pr-4 align-top";

export default function RulebookPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-label font-semibold tracking-[0.06em] text-fg-muted uppercase">FleetOS · rulebook</p>
        <h1 className="font-display text-display-l font-semibold [font-stretch:112.5%]">How FleetOS calculates</h1>
        <p className="max-w-2xl text-fg-muted">
          Every number below is computed live by the same code the product uses (<code>packages/domain</code>), on the
          worked examples from the KPI dictionary. When a formula changes, this page changes with it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <DataSourceBadge source="sample" />
          <Link href="/design" className="text-label text-fg-muted underline underline-offset-4 hover:text-fg">
            Design system
          </Link>
        </div>
      </header>

      <Section
        id="status-rules"
        title="1. What is each car doing?"
        rule="Rules are checked in order and the first match wins: incident, offline, maintenance, cleaning, charging, in service, ready."
      >
        <div className="overflow-x-auto" role="region" aria-label="Status rules table" tabIndex={0}>
          <table className="w-full min-w-[40rem] text-body">
            <caption className="sr-only">Vehicle situations and the status the rules assign</caption>
            <thead className="border-b border-divider">
              <tr>
                <th scope="col" className={th}>
                  Car
                </th>
                <th scope="col" className={th}>
                  Situation
                </th>
                <th scope="col" className={th}>
                  Status
                </th>
                <th scope="col" className={th}>
                  Why
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {SCENARIOS.map((s) => {
                const r = deriveStatus({ ...BASE, ...s.inputs });
                return (
                  <tr key={s.car}>
                    <td className={`${td} font-mono text-mono`}>{s.car}</td>
                    <td className={td}>{s.situation}</td>
                    <td className={td}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className={`${td} text-fg-muted`}>
                      {r.reason}
                      {r.immediate ? " · applies immediately" : " · after 60 s"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="day"
        title="2. A morning for car 047 (06:00 to 12:00)"
        rule="Every minute is in exactly one status. Availability counts charging and cleaning as down; uptime only counts unplanned problems."
      >
        <ol className="flex flex-col gap-2">
          {DAY.map((d) => (
            <li key={d.time} className="flex flex-wrap items-center gap-3">
              <span className="w-12 font-mono text-mono text-fg-muted">{d.time}</span>
              <StatusBadge status={d.to} />
              <span className="text-fg-muted">{d.what}</span>
            </li>
          ))}
        </ol>
        <dl className="grid gap-5 sm:grid-cols-4">
          <Result label="In service" value={formatHours(dayHours.in_service)} />
          <Result label="Cleaning (planned downtime)" value={formatHours(dayHours.cleaning)} />
          <Result label="Availability" value={formatPct(availability(dayTotals))} />
          <Result label="Uptime" value={formatPct(uptime(dayTotals))} />
        </dl>
      </Section>

      <Section
        id="pnl"
        title="3. Is car 047 making money? (month to date)"
        rule="Contribution is revenue minus variable costs. Insurance and financing come after. Downtime is lost revenue, shown beside the total, never subtracted twice."
      >
        <div className="overflow-x-auto" role="region" aria-label="Car 047 profit and loss table" tabIndex={0}>
          <table className="w-full min-w-[28rem] text-body">
            <caption className="sr-only">Car 047 profit and loss, month to date</caption>
            <tbody className="divide-y divide-divider">
              {LINES.map((l) => (
                <tr key={l.category}>
                  <th scope="row" className={`${td} text-left font-normal`}>
                    {l.label}
                  </th>
                  <td className={`${td} text-right`}>
                    {formatCents(l.category === "gross_ride_revenue" ? l.dollars * 100 : -l.dollars * 100)}
                  </td>
                </tr>
              ))}
              <tr>
                <th scope="row" className={`${td} text-left font-semibold`}>
                  Contribution (after variable costs)
                </th>
                <td className={`${td} text-right font-semibold`}>
                  {formatCents(statement.contributionCents)} · {formatPct(statement.contributionMargin)}
                </td>
              </tr>
              <tr>
                <th scope="row" className={`${td} text-left font-semibold`}>
                  Net vehicle contribution (after insurance + financing)
                </th>
                <td className={`${td} text-right font-semibold`}>
                  {formatCents(statement.netContributionCents)} · {formatPct(statement.netMargin)}
                </td>
              </tr>
              <tr>
                <th scope="row" className={`${td} text-left text-fg-muted`}>
                  Memo: downtime (lost revenue, not subtracted)
                </th>
                <td className={`${td} text-right text-fg-muted`}>{formatCents(DOWNTIME_COST)}</td>
              </tr>
              <tr>
                <th scope="row" className={`${td} text-left text-fg-muted`}>
                  Economic view (net minus downtime) — the MVP&apos;s figure
                </th>
                <td className={`${td} text-right text-fg-muted`}>
                  {formatCents(economicNetCents(statement, DOWNTIME_COST))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          id="risk"
          title="4. What is car 052's breakdown costing?"
          rule="Revenue at risk = expected remaining downtime × what the car normally earns per available hour."
        >
          <p className="text-fg-muted">
            Tow ETA 0.3 h + typical recovery 5.2 h = {remaining052.toFixed(1)} h × {formatRatePerHour(RATE_052)}
          </p>
          <dl>
            <Result label="Revenue at risk" value={formatCents(-atRisk052, { decimals: true })} tone="loss" />
          </dl>
        </Section>

        <Section
          id="incident"
          title="5. What did car 047's spill cost?"
          rule="Incident cost = lost revenue while down + the service bill. Finishing inside the SLA saves revenue."
        >
          <p className="text-fg-muted">
            47 min down × {formatRatePerHour(RATE_047)} (morning peak) + {formatCents(spill.serviceCostCents)} cleaning
          </p>
          <dl className="grid gap-5 sm:grid-cols-3">
            <Result label="Lost revenue" value={formatCents(-spill.lostRevenueCents, { decimals: true })} tone="loss" />
            <Result label="Total cost" value={formatCents(-spill.totalCents, { decimals: true })} tone="loss" />
            <Result
              label="Saved (13 min inside SLA)"
              value={formatCents(recovered, { decimals: true, signed: true })}
              tone="gain"
            />
          </dl>
        </Section>
      </div>

      <Section
        id="grade"
        title="6. What grade does the lender see? (August)"
        rule="Weighted score: uptime vs covenant 30%, margin 25%, reserve 15%, incidents 15%, vendor SLA 15%."
      >
        <dl className="grid gap-5 sm:grid-cols-3">
          <Result label="Asset health grade" value={grade.letter} />
          <Result label="Score" value={grade.score.toFixed(1)} />
          <Result label="Covenant: uptime > 94%" value={COVENANT_TEXT[covenantStatus(AUGUST.uptime, ">", 0.94)]} />
        </dl>
        <ul className="flex flex-col gap-1 text-fg-muted">
          {COVENANTS.map((c) => (
            <li key={c.label}>
              {formatPct(c.value)} → <span className="font-semibold text-fg">{COVENANT_TEXT[c.status]}</span>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  );
}
