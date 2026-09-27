import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PAYOUT_FIELDS,
  REQUIRED_PAYOUT_FIELDS,
  parseCsv,
  validatePayoutRows,
  type ColumnMapping,
  type RowError,
} from "@fleetos/domain";
import { Button } from "@fleetos/ui/components/button";
import { commitPayoutImport, remapPayoutImport } from "@/app/actions/revenue-import";
import { PageHeader } from "@/components/shell/page-header";
import { formatCents } from "@/lib/format";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Payout import" };

const FIELD_LABEL: Record<(typeof PAYOUT_FIELDS)[number], string> = {
  date: "Date",
  vehicle: "Vehicle (VIN, number or name)",
  gross: "Gross earnings",
  fee: "Platform fee",
  tips: "Tips",
  trips: "Trips",
  online_hours: "Online hours",
};

export default async function ImportReportPage({ params }: PageProps<"/financials/imports/[id]">) {
  const { id } = await params;
  const { activeOrg } = await getAppContext();
  if (!activeOrg) notFound();
  const supabase = await createClient();
  const { data: imp } = await supabase
    .from("revenue_imports")
    .select("*")
    .eq("id", id)
    .eq("org_id", activeOrg.id)
    .maybeSingle();
  if (!imp) notFound();

  const parsed = parseCsv(imp.raw_text as string);
  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("id, vin, number, display_name")
    .eq("org_id", activeOrg.id);
  const result = validatePayoutRows(
    parsed,
    imp.mapping as ColumnMapping,
    (vehicles ?? []).map((v) => ({ id: v.id, vin: v.vin, number: v.number, displayName: v.display_name })),
  );
  const errors = imp.errors as RowError[];
  const committed = imp.status === "imported";
  const commit = commitPayoutImport.bind(null, id);
  const remap = remapPayoutImport.bind(null, id);
  const mappingProblem = REQUIRED_PAYOUT_FIELDS.some((f) => !(imp.mapping as ColumnMapping)[f]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={imp.filename as string}
        summary={
          imp.layout === "uber_fleet_portal"
            ? "Recognised as an Uber-Fleet-Portal-style statement."
            : "Custom layout: check the column mapping below."
        }
      />
      <Link href="/financials/imports" className="text-label text-fg-muted underline underline-offset-4">
        ← All imports
      </Link>

      <section
        aria-labelledby="summary"
        className="flex flex-col gap-4 rounded-md border border-divider bg-surface p-6"
      >
        <h2 id="summary" className="text-title font-semibold">
          {committed ? "Imported" : "Check before booking"}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-label text-fg-muted">Rows in file</dt>
            <dd className="font-display text-display-l font-semibold">{imp.rows_total}</dd>
          </div>
          <div>
            <dt className="text-label text-fg-muted">Valid rows</dt>
            <dd className="font-display text-display-l font-semibold">{imp.rows_valid}</dd>
          </div>
          <div>
            <dt className="text-label text-fg-muted">Rows with problems</dt>
            <dd className="font-display text-display-l font-semibold">
              {(imp.rows_total as number) - (imp.rows_valid as number)}
            </dd>
          </div>
        </dl>
        {committed ? (
          <p role="status" className="text-body">
            <strong>{imp.rows_imported}</strong> new ledger lines booked; <strong>{imp.rows_already_imported}</strong>{" "}
            were already imported and skipped.
          </p>
        ) : (
          <form action={commit}>
            <Button type="submit" variant="primary" disabled={result.valid.length === 0}>
              Commit {result.valid.length} valid rows to the ledger
            </Button>
          </form>
        )}
      </section>

      {!committed && (mappingProblem || imp.layout === "custom") ? (
        <section
          aria-labelledby="mapping"
          className="flex flex-col gap-4 rounded-md border border-divider bg-surface p-6"
        >
          <h2 id="mapping" className="text-title font-semibold">
            Column mapping
          </h2>
          <form action={remap} className="grid gap-4 sm:grid-cols-2">
            {PAYOUT_FIELDS.map((f) => (
              <div key={f} className="flex flex-col gap-1.5">
                <label htmlFor={`map-${f}`} className="text-label font-medium">
                  {FIELD_LABEL[f]}
                  {REQUIRED_PAYOUT_FIELDS.includes(f) ? " *" : ""}
                </label>
                <select
                  id={`map-${f}`}
                  name={f}
                  defaultValue={(imp.mapping as ColumnMapping)[f] ?? ""}
                  className="h-10 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg"
                >
                  <option value="">Not in this file</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary">
                Save mapping and re-check
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {errors.length ? (
        <section aria-labelledby="problems" className="flex flex-col gap-3">
          <h2 id="problems" className="text-title font-semibold">
            Problems ({errors.length})
          </h2>
          <p className="text-fg-muted">Rows with problems are skipped. Fix them in the file and upload it again.</p>
          <div
            className="overflow-x-auto rounded-md border border-divider"
            role="region"
            aria-label="Problems"
            tabIndex={0}
          >
            <table className="w-full min-w-[32rem] text-body">
              <thead className="border-b border-divider bg-raised">
                <tr>
                  {["Row", "Column", "Problem"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 text-left text-label font-medium text-fg-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {errors.slice(0, 50).map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-mono text-mono">{e.row || "—"}</td>
                    <td className="px-4 py-2">{e.column}</td>
                    <td className="px-4 py-2">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {result.valid.length ? (
        <section aria-labelledby="preview" className="flex flex-col gap-3">
          <h2 id="preview" className="text-title font-semibold">
            Preview (first {Math.min(20, result.valid.length)} valid rows)
          </h2>
          <div
            className="overflow-x-auto rounded-md border border-divider"
            role="region"
            aria-label="Preview"
            tabIndex={0}
          >
            <table className="w-full min-w-[36rem] text-body">
              <thead className="border-b border-divider bg-raised">
                <tr>
                  {["Row", "Date", "Vehicle", "Gross", "Fee", "Tips"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 text-left text-label font-medium text-fg-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {result.valid.slice(0, 20).map((r) => (
                  <tr key={r.row}>
                    <td className="px-4 py-2 font-mono text-mono">{r.row}</td>
                    <td className="px-4 py-2 font-mono text-mono">{r.date}</td>
                    <td className="px-4 py-2">{r.vehicleLabel}</td>
                    <td className="px-4 py-2">{formatCents(r.grossCents, { decimals: true })}</td>
                    <td className="px-4 py-2">{formatCents(-r.feeCents, { decimals: true })}</td>
                    <td className="px-4 py-2">{formatCents(r.tipsCents, { decimals: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
