import type { Metadata, Route } from "next";
import Link from "next/link";
import { cn } from "@fleetos/ui/lib/cn";
import { AutoSubmitForm } from "@/components/fleet/auto-submit-form";
import { TelemetryChartLazy as TelemetryChart } from "@/components/vehicle/telemetry-chart-lazy";
import { getTelemetry } from "@/lib/services/telemetry";
import { loadVehiclePage } from "@/lib/services/vehicle-page";
import {
  displayValue,
  TELEMETRY_FIELDS,
  TELEMETRY_FIELD_NAMES,
  type TelemetryField,
  type TelemetryInterval,
} from "@/lib/telemetry-fields";

export async function generateMetadata({ params }: PageProps<"/fleet/[number]/telemetry">): Promise<Metadata> {
  return { title: `Cybercab ${(await params).number} · Telemetry` };
}

const RANGES = {
  "1h": { ms: 3_600_000, interval: "raw" },
  "24h": { ms: 86_400_000, interval: "1m" },
  "7d": { ms: 7 * 86_400_000, interval: "1h" },
} as const;
const DIGITS: Record<TelemetryField, number> = {
  soc: 0,
  speed_mps: 0,
  odometer_m: 1,
  charge_power_kw: 1,
  tpms_fl_bar: 2,
  tpms_fr_bar: 2,
  tpms_rl_bar: 2,
  tpms_rr_bar: 2,
};
const TELEMETRY_ROLES = new Set(["owner", "admin", "ops"]);

/** Telemetry history (PRD VD-7): one field at a time over 1 h / 24 h / 7 d, as a chart, a summary and a table. */
export default async function VehicleTelemetry({ params, searchParams }: PageProps<"/fleet/[number]/telemetry">) {
  const { number } = await params;
  const sp = await searchParams;
  const { org, db, vehicle: v } = await loadVehiclePage(number);
  if (!TELEMETRY_ROLES.has(org.role))
    return (
      <p className="rounded-md border border-divider bg-surface p-6 text-fg-muted">
        Telemetry history includes location, so it&apos;s visible to owners, admins and ops.
      </p>
    );
  const field = (TELEMETRY_FIELD_NAMES as string[]).includes(String(sp.field)) ? (sp.field as TelemetryField) : "soc";
  const range = (Object.keys(RANGES) as (keyof typeof RANGES)[]).includes(sp.range as keyof typeof RANGES)
    ? (sp.range as keyof typeof RANGES)
    : "24h";
  const to = new Date(v.as_of);
  const from = new Date(to.getTime() - RANGES[range].ms);
  const result = await getTelemetry(db, org.id, v.id, {
    fields: [field],
    from: from.toISOString(),
    to: to.toISOString(),
    interval: RANGES[range].interval as TelemetryInterval,
  });
  const meta = TELEMETRY_FIELDS[field];
  const pts = (result.series[0]?.points ?? []).map((p) => ({ t: Date.parse(p.t), v: displayValue(field, p.v) }));
  const digits = DIGITS[field];
  const fmt = (x: number) =>
    `${x.toLocaleString("en-US", { maximumFractionDigits: digits })}${meta.unit === "%" ? "" : " "}${meta.unit}`;
  const values = pts.map((p) => p.v);
  const base = `/fleet/${encodeURIComponent(v.number)}/telemetry`;
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: org.timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const summary = pts.length
    ? `${meta.label} over the last ${range}: latest ${fmt(values.at(-1)!)}, lowest ${fmt(Math.min(...values))}, highest ${fmt(Math.max(...values))}, from ${pts.length} readings.`
    : `No ${meta.label.toLowerCase()} readings in the last ${range}.`;
  return (
    <section aria-labelledby="telemetry" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="telemetry" className="text-title font-semibold">
          {meta.label} · last {range}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <AutoSubmitForm method="get" action={base} className="flex items-end gap-2">
            <input type="hidden" name="range" value={range} />
            <div className="flex flex-col gap-1">
              <label htmlFor="field" className="text-label text-fg-muted">
                Field
              </label>
              <select
                id="field"
                name="field"
                defaultValue={field}
                className="h-11 rounded-sm border border-border-control bg-canvas px-3 text-body lg:h-9"
              >
                {TELEMETRY_FIELD_NAMES.map((f) => (
                  <option key={f} value={f}>
                    {TELEMETRY_FIELDS[f].label}
                  </option>
                ))}
              </select>
            </div>
            <noscript>
              <button type="submit" className="h-9 rounded-sm border border-border-control px-3">
                Show
              </button>
            </noscript>
          </AutoSubmitForm>
          <nav aria-label="Time range" className="flex gap-2">
            {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((r) => (
              <Link
                key={r}
                href={`${base}?field=${field}&range=${r}` as Route}
                aria-current={r === range ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-full border px-3 text-label lg:min-h-8",
                  r === range ? "border-fg bg-raised" : "border-divider hover:bg-raised",
                )}
              >
                {r}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <p className="text-body text-fg-muted">{summary}</p>
      {pts.length ? (
        <>
          <div
            role="group"
            aria-label={`${meta.label} chart. Focus it and use the arrow keys to read values; the same data is in the table below.`}
          >
            <TelemetryChart
              points={pts}
              unit={meta.unit}
              label={meta.label}
              timeZone={org.timezone}
              holdMs={3_600_000}
              from={from.getTime()}
              to={to.getTime()}
              digits={digits}
            />
          </div>
          <p className="text-label text-fg-muted">
            Cars report a value when it changes, so the line holds the last reading; it breaks after an hour without
            data.
            {org.isDemo ? " Simulated data." : ""}
          </p>
          <details className="rounded-md border border-divider bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-body font-medium">
              View as table ({pts.length} readings)
            </summary>
            <div className="max-h-96 overflow-y-auto" role="region" aria-label={`${meta.label} readings`} tabIndex={0}>
              <table className="w-full text-body">
                <thead className="sticky top-0 border-b border-divider bg-raised">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-label font-medium text-fg-muted">
                      Time
                    </th>
                    <th scope="col" className="px-4 py-2 text-right text-label font-medium text-fg-muted">
                      {meta.label}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {[...pts].reverse().map((p) => (
                    <tr key={p.t}>
                      <td className="px-4 py-1.5 font-mono text-mono">{when.format(new Date(p.t))}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{fmt(p.v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="rounded-md border border-dashed border-border-strong p-6 text-fg-muted">
          Nothing reported for this field in the last {range}. Try a longer range or another field.
        </p>
      )}
    </section>
  );
}
