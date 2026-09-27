import type { Metadata, Route } from "next";
import Link from "next/link";
import { STATUS_META, StatusBadge } from "@fleetos/ui/components/status-badge";
import { localDay } from "@/lib/api/period";
import { formatCents } from "@/lib/format";
import { vehicleTimeline, type TimelineItem } from "@/lib/services/vehicle-activity";
import { loadVehiclePage } from "@/lib/services/vehicle-page";

export async function generateMetadata({ params }: PageProps<"/fleet/[number]/operations">): Promise<Metadata> {
  return { title: `Cybercab ${(await params).number} · Operations` };
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const CATEGORY: Record<string, string> = { cleaning: "Cleaning", maintenance: "Repair", roadside: "Roadside & towing" };

function Line({ item, tz }: { item: TimelineItem; tz: string }) {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(item.at));
  let glyph = "·";
  let body: React.ReactNode;
  switch (item.kind) {
    case "status":
      glyph = "·"; // the badge carries the status shape
      body = (
        <>
          {item.from ? `${STATUS_META[item.from].label} → ` : "Status: "}
          <StatusBadge status={item.to} />
          {item.detail ? <span className="text-fg-muted"> · {item.detail}</span> : null}
        </>
      );
      break;
    case "alert":
      glyph = item.phase === "started" ? "▲" : "✓";
      body = (
        <>
          Alert {item.phase === "started" ? "raised" : "cleared"}:{" "}
          <span className="font-mono text-mono">{item.name}</span>
        </>
      );
      break;
    case "charge":
      glyph = "◐";
      body =
        item.phase === "started"
          ? `Started charging${item.hub ? ` at ${item.hub}` : ""}`
          : `Finished charging: ${item.energyKwh?.toFixed(1)} kWh${item.costCents !== null ? `, ${formatCents(item.costCents, { decimals: true })}` : ""}`;
      break;
    case "cabin":
      glyph = "◇";
      body = `Cabin camera: ${item.eventKind}${item.confidence !== null ? ` (${Math.round(item.confidence * 100)}% confidence)` : ""}`;
      break;
    case "autonomy":
      glyph = "▲";
      body = `Autonomy: ${item.eventKind}${item.detail ? ` · ${item.detail}` : ""}`;
      break;
    case "cost":
      glyph = "$";
      body = `${CATEGORY[item.category] ?? item.category} cost ${formatCents(-item.amountCents, { decimals: true })}${item.note ? ` · ${item.note}` : ""}`;
      break;
  }
  return (
    <li className="grid grid-cols-[3.5rem_1.25rem_1fr] gap-2 py-2">
      <time dateTime={item.at} className="font-mono text-mono text-fg-muted tabular-nums">
        {time}
      </time>
      <span aria-hidden="true" className="text-center text-fg-subtle">
        {glyph}
      </span>
      <span>{body}</span>
    </li>
  );
}

/** A day of the vehicle's activity (PRD VD-5), newest first; "Earlier" walks back a day at a time. */
export default async function VehicleOperations({ params, searchParams }: PageProps<"/fleet/[number]/operations">) {
  const { number } = await params;
  const { org, db, vehicle: v } = await loadVehiclePage(number);
  const today = localDay(new Date(v.as_of), org.timezone);
  const asked = String((await searchParams).day ?? "");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  const items = await vehicleTimeline(db, org, v.id, day);
  const base = `/fleet/${encodeURIComponent(v.number)}/operations`;
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
  return (
    <section aria-labelledby="timeline" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="timeline" className="text-title font-semibold">
          {day === today ? "Today" : label}{" "}
          <span className="text-body font-normal text-fg-muted">· {items.length} events</span>
        </h2>
        <nav aria-label="Days" className="flex gap-2">
          <Link
            href={`${base}?day=${addDays(day, -1)}` as Route}
            className="inline-flex h-11 items-center rounded-sm border border-border-control px-3 text-body hover:bg-raised lg:h-9"
          >
            ← Earlier
          </Link>
          {day !== today ? (
            <Link
              href={(addDays(day, 1) === today ? base : `${base}?day=${addDays(day, 1)}`) as Route}
              className="inline-flex h-11 items-center rounded-sm border border-border-control px-3 text-body hover:bg-raised lg:h-9"
            >
              Later →
            </Link>
          ) : null}
        </nav>
      </div>
      {items.length ? (
        <ol className="divide-y divide-divider rounded-md border border-divider bg-surface px-4">
          {items.map((i, n) => (
            <Line key={`${i.kind}-${i.at}-${n}`} item={i} tz={org.timezone} />
          ))}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed border-border-strong p-6 text-fg-muted">
          Nothing happened on this day. Try an earlier day.
        </p>
      )}
    </section>
  );
}
