import { cn } from "@fleetos/ui/lib/cn";
import type { ReportData } from "@/lib/report-data";
import { formatCents, formatPct } from "@/lib/format";

/**
 * The monthly asset performance report (PRD RP-1..RP-5) in the Paper theme: a financial document for lenders.
 * Pure server render of a frozen snapshot, so the in-app view, the share link and the PDF are identical.
 */
const STATUS = {
  pass: { glyph: "✓", label: "Pass", cls: "text-status-available" },
  at_risk: { glyph: "◆", label: "At risk", cls: "text-status-maintenance" },
  breach: { glyph: "▲", label: "Breach", cls: "text-severity-critical" },
  not_tracked: { glyph: "○", label: "Not tracked", cls: "text-fg-subtle" },
} as const;
const monthName = (m: string) =>
  new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fmtValue = (metric: string, v: number | null) =>
  v === null ? "Not tracked" : metric === "incidents_per_10k_rides" ? v.toFixed(2) : formatPct(v);
const th = "border-b border-divider py-1.5 pr-3 text-left text-label font-medium text-fg-muted";
const td = "border-b border-divider py-1.5 pr-3 tabular-nums";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex break-inside-avoid flex-col gap-2">
      <h2 id={id} className="font-display text-title font-semibold [font-stretch:112.5%]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Daily availability as a small line with the target, drawn in SVG so it prints without scripts. */
function AvailabilitySpark({ days, target }: { days: ReportData["availability_by_day"]; target: number }) {
  const pts = days.filter((d) => d.availability !== null) as { day: string; availability: number }[];
  if (pts.length < 2)
    return (
      <p className="text-label text-fg-muted">
        The daily chart needs at least two days of hours; this period has {pts.length}.
      </p>
    );
  const w = 600;
  const h = 120;
  const lo = Math.min(target, ...pts.map((p) => p.availability)) - 0.02;
  const hi = 1;
  const x = (i: number) => (i / (pts.length - 1)) * (w - 8) + 4;
  const y = (v: number) => h - 8 - ((v - lo) / (hi - lo)) * (h - 16);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Daily availability for the month against the target"
      className="w-full"
    >
      <line
        x1={0}
        x2={w}
        y1={y(target)}
        y2={y(target)}
        stroke="var(--fo-fg-muted)"
        strokeDasharray="4 4"
        strokeWidth={1}
      />
      <text x={w - 4} y={y(target) - 4} textAnchor="end" fontSize={11} fill="var(--fo-fg-muted)">
        Target {formatPct(target, 0)}
      </text>
      <polyline
        fill="none"
        stroke="var(--fo-chart-1)"
        strokeWidth={2}
        points={pts.map((p, i) => `${x(i)},${y(p.availability)}`).join(" ")}
      />
    </svg>
  );
}

export function ReportDocument({
  data,
  version,
  generatedAt,
  recipient,
}: {
  data: ReportData;
  version: number;
  generatedAt: string;
  recipient?: string;
}) {
  const s = data.summary;
  const uptimeTarget = data.covenants.find((c) => c.metric === "uptime")?.threshold ?? 0.94;
  return (
    <article
      data-theme="paper"
      className="mx-auto flex w-full max-w-4xl flex-col gap-8 rounded-md bg-canvas p-6 text-fg sm:p-10 print:max-w-none print:rounded-none print:p-0"
    >
      <header className="flex flex-col gap-2 border-b border-border-strong pb-4">
        <p className="text-label font-semibold tracking-[0.06em] text-fg-muted uppercase">
          {data.org_name} · Asset performance report
        </p>
        <h1 className="font-display text-display-l font-semibold [font-stretch:112.5%]">{monthName(data.month)}</h1>
        <p className="text-label text-fg-muted">
          {data.period.from} to {data.period.to} · version {version} · generated{" "}
          {new Date(generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })}{" "}
          UTC
          {data.data_source === "simulated" ? " · simulated demo data" : ""}
        </p>
        {data.preliminary ? (
          <p className="rounded-sm border border-status-maintenance px-3 py-2 text-body">
            Preliminary: the month hasn&apos;t closed yet, so these figures will change. Generate again after month end.
          </p>
        ) : null}
        {recipient ? <p className="text-label text-fg-muted">Prepared for {recipient}. Read-only copy.</p> : null}
      </header>

      <Section id="covenants" title="Covenants">
        <table className="w-full text-body">
          <thead>
            <tr>
              <th className={th}>Covenant</th>
              <th className={th}>Value</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.covenants.map((c) => (
              <tr key={c.metric}>
                <td className={td}>{c.label}</td>
                <td className={td}>{fmtValue(c.metric, c.value)}</td>
                <td className={td}>
                  <span className={cn("inline-flex items-center gap-1.5 font-medium", STATUS[c.status].cls)}>
                    <span aria-hidden="true">{STATUS[c.status].glyph}</span>
                    {STATUS[c.status].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="summary" title="Executive summary">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {(
              [
                ["Ride revenue", formatCents(s.revenue_cents)],
                [
                  "Contribution",
                  `${formatCents(s.contribution_cents, { signed: true })} (${formatPct(s.contribution_margin)})`,
                ],
                ["Net after insurance & financing", formatCents(s.net_contribution_cents, { signed: true })],
                ["Availability", formatPct(s.availability)],
                ["Uptime", formatPct(s.uptime)],
                ["Revenue per vehicle", formatCents(s.revenue_per_vehicle_cents)],
                ["Vehicles", String(s.fleet_size)],
                ["Downtime cost (lost rides)", formatCents(s.downtime_cost_cents)],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-label text-fg-muted">{k}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col items-start gap-1 rounded-sm border border-border-strong p-4">
            <span className="text-label text-fg-muted">Asset health grade</span>
            <span className="font-display text-display-xl font-semibold">{data.grade?.letter ?? "—"}</span>
            {data.grade ? (
              <span className="text-label text-fg-muted tabular-nums">Score {data.grade.score} / 100</span>
            ) : null}
            <details className="text-label">
              <summary className="cursor-pointer text-fg-muted">How is this calculated?</summary>
              <p className="mt-1 text-fg-muted">
                Weighted: uptime vs covenant 30%, margin vs target 25%, maintenance reserve 15%, incident rate 15%,
                vendor SLA 15%. Parts without data are left out and the rest reweighted. A ≥ 90, A− ≥ 85, B+ ≥ 80, B ≥
                75, B− ≥ 70, C ≥ 60, else D.
              </p>
            </details>
          </div>
        </div>
      </Section>

      <Section id="availability" title="Availability">
        <p className="text-label text-fg-muted">
          {s.availability === null
            ? "No hours recorded."
            : `${formatPct(s.availability)} of scheduled hours available; uptime ${formatPct(s.uptime)} against the ${formatPct(uptimeTarget, 0)} covenant.`}
        </p>
        {s.availability === null ? null : <AvailabilitySpark days={data.availability_by_day} target={uptimeTarget} />}
      </Section>

      <Section id="pnl" title="Revenue and contribution">
        <table className="w-full text-body">
          <tbody>
            {data.pnl.map((r) => (
              <tr key={r.label} className={cn(r.kind === "total" && "font-semibold")}>
                <td className={td}>{r.label}</td>
                <td className={cn(td, "text-right")}>{formatCents(r.cents, { decimals: true })}</td>
                <td className={cn(td, "text-right text-fg-muted")}>{formatPct(r.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="vehicles" title="Vehicle performance">
        <p className="text-label text-fg-muted">
          {data.vehicles.labels.strong} strong · {data.vehicles.labels.monitor} to monitor ·{" "}
          {data.vehicles.labels.review} to review.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {(
            [
              ["Highest revenue", data.vehicles.top],
              ["Lowest revenue", data.vehicles.bottom],
            ] as const
          ).map(([title, list]) => (
            <table key={title} className="w-full text-body">
              <caption className="pb-1 text-left text-label font-medium">{title}</caption>
              <thead>
                <tr>
                  <th className={th}>Vehicle</th>
                  <th className={th}>Revenue</th>
                  <th className={th}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.number}>
                    <td className={td}>{v.number}</td>
                    <td className={td}>{formatCents(v.revenue_cents)}</td>
                    <td className={td}>{formatPct(v.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </Section>

      <Section id="maintenance" title="Maintenance">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {(
            [
              ["Service tickets", String(data.maintenance.tickets)],
              ["Service cost", formatCents(data.maintenance.cost_cents)],
              ["SLA compliance", formatPct(data.maintenance.sla_compliance)],
              ["Maintenance downtime", `${data.maintenance.downtime_hours} h`],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-label text-fg-muted">{k}</dt>
              <dd className="font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="incidents" title="Incidents">
        {data.incidents.tracked ? (
          <p>
            {data.incidents.autonomy_incidents} autonomy incidents over {data.incidents.rides?.toLocaleString("en-US")}{" "}
            rides ({data.incidents.per_10k_rides ?? "—"} per 10,000 rides); {data.incidents.exceptions} incident
            exceptions handled.
          </p>
        ) : (
          <p className="text-fg-muted">
            Not yet tracked: connect a source of autonomy incident data. {data.incidents.exceptions} incident exceptions
            (tyres, breakdowns) were handled.
          </p>
        )}
      </Section>

      <Section id="vendors" title="Vendor performance">
        {data.vendors.length ? (
          <table className="w-full text-body">
            <thead>
              <tr>
                <th className={th}>Vendor</th>
                <th className={th}>Jobs</th>
                <th className={th}>Average cost</th>
                <th className={th}>SLA met</th>
              </tr>
            </thead>
            <tbody>
              {data.vendors.map((v) => (
                <tr key={v.name}>
                  <td className={td}>{v.name}</td>
                  <td className={td}>{v.jobs}</td>
                  <td className={td}>{formatCents(v.avg_cost_cents)}</td>
                  <td className={td}>{formatPct(v.sla_compliance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-fg-muted">No vendor jobs this month.</p>
        )}
      </Section>

      <Section id="hubs" title="Hub performance">
        <table className="w-full text-body">
          <thead>
            <tr>
              <th className={th}>Hub</th>
              <th className={th}>Vehicles</th>
              <th className={th}>Revenue</th>
              <th className={th}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {data.hubs.map((h) => (
              <tr key={h.name}>
                <td className={td}>{h.name}</td>
                <td className={td}>{h.cars}</td>
                <td className={td}>{formatCents(h.revenue_cents)}</td>
                <td className={td}>{formatPct(h.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="risks" title="Risk indicators">
        {data.risks.length ? (
          <ul className="list-disc pl-5">
            {data.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted">No covenant close to its limit and no outlier vehicles or hubs.</p>
        )}
      </Section>

      <footer className="border-t border-border-strong pt-3 text-label text-fg-muted">
        {data.org_name} · FleetOS · Figures are a snapshot at generation and don&apos;t change.
        {recipient ? ` Prepared for ${recipient}.` : ""}
      </footer>
    </article>
  );
}
