import type { Metadata, Route } from "next";
import Link from "next/link";
import { FileBarChart } from "lucide-react";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { ActionForm } from "@/components/settings/action-form";
import { PageHeader } from "@/components/shell/page-header";
import { generateReportAction } from "@/app/actions/reports";
import { localDay } from "@/lib/api/period";
import { formatWhen } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listReports } from "@/lib/services/reports";

export const metadata: Metadata = { title: navItem("reports").label };
const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const monthName = (m: string) =>
  new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Reports (PRD RP-1): monthly asset performance snapshots for lenders; each generation is a new version. */
export default async function ReportsPage() {
  const item = navItem("reports");
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const allowed = ["owner", "admin", "finance"].includes(activeOrg.role);
  const reports = allowed ? await listReports(await createClient(), activeOrg) : [];
  const thisMonth = localDay(new Date(), activeOrg.timezone).slice(0, 7);
  const months = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(`${thisMonth}-15T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    return d.toISOString().slice(0, 7);
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={item.label} summary={item.summary} />
      {!allowed ? (
        <p className="rounded-md border border-divider bg-surface p-6 text-fg-muted">
          Reports are for owners, admins and finance.
        </p>
      ) : (
        <>
          <section
            aria-labelledby="generate"
            className="flex max-w-xl flex-col gap-3 rounded-md border border-divider bg-surface p-4"
          >
            <h2 id="generate" className="text-title font-semibold">
              Generate a monthly report
            </h2>
            <ActionForm action={generateReportAction} submit="Generate report" pendingLabel="Generating…">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="month" className="text-label font-medium">
                  Month
                </label>
                <select id="month" name="month" defaultValue={months[1]} className={input}>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthName(m)}
                      {m === thisMonth ? " (so far, preliminary)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </ActionForm>
          </section>
          {reports.length === 0 ? (
            <EmptyState
              icon={<FileBarChart aria-hidden="true" />}
              title="No reports yet"
              description="Generate one for a closed month. It's a snapshot: its numbers stay the same, and you can export it as PDF or share a read-only link with a lender."
            />
          ) : (
            <section aria-labelledby="list" className="flex flex-col gap-3">
              <h2 id="list" className="text-title font-semibold">
                Reports
              </h2>
              <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
                {reports.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <Link href={`/reports/${r.id}` as Route} className="font-medium hover:underline">
                      {monthName(r.month)} · version {r.version}
                      {r.preliminary ? (
                        <span className="text-label font-normal text-fg-muted"> · preliminary</span>
                      ) : null}
                    </Link>
                    <span className="flex items-center gap-4 text-label text-fg-muted">
                      <span>
                        Grade <span className="font-semibold text-fg">{r.grade ?? "—"}</span>
                      </span>
                      {r.generated_at ? <span>{formatWhen(r.generated_at, activeOrg.timezone)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
