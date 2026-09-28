import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { ReportDocument } from "@/components/reports/report-document";
import { ActionForm } from "@/components/settings/action-form";
import { revokeShareAction, shareReportAction } from "@/app/actions/reports";
import { ApiProblem } from "@/lib/api/problem";
import { formatWhen } from "@/lib/format";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getReport, listShares } from "@/lib/services/reports";

export const metadata: Metadata = { title: "Report" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";

/** One report version (flows.md F5): the Paper-theme document, Export PDF, and read-only share links. */
export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  if (!["owner", "admin", "finance"].includes(activeOrg.role)) notFound();
  const db = await createClient();
  const report = await getReport(db, activeOrg, id).catch((e) => {
    if (e instanceof ApiProblem && e.code === "not_found") notFound();
    throw e;
  });
  const shares = await listShares(db, activeOrg, id);
  const now = new Date().toISOString();
  return (
    <div className="flex flex-col gap-6">
      <Link href="/reports" className="self-start text-label text-fg-muted underline underline-offset-4">
        ← Reports
      </Link>
      <div className="flex flex-wrap items-start gap-6">
        <a
          href={`/reports/${id}/pdf`}
          className="inline-flex h-11 items-center gap-2 rounded-sm bg-chalk px-4 text-body font-medium text-chalk-fg lg:h-9"
        >
          <Download aria-hidden="true" className="size-4" /> Export PDF
        </a>
        <section
          aria-labelledby="share"
          className="flex min-w-0 flex-1 flex-col gap-3 rounded-md border border-divider bg-surface p-4"
        >
          <h2 id="share" className="text-title font-semibold">
            Share read-only
          </h2>
          <ActionForm
            action={shareReportAction.bind(null, id)}
            submit="Create link"
            pendingLabel="Creating…"
            linkLabel="Share link"
            linkNote="read-only; copy it now, it isn't shown again"
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="recipient" className="text-label font-medium">
                  For (shown on the copy)
                </label>
                <input
                  id="recipient"
                  name="recipient"
                  placeholder="e.g. Harbor Bank credit team"
                  maxLength={120}
                  className={input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="days" className="text-label font-medium">
                  Expires in (days)
                </label>
                <input id="days" name="days" inputMode="numeric" defaultValue={30} className={input} />
              </div>
            </div>
          </ActionForm>
          {shares.length ? (
            <ul className="divide-y divide-divider rounded-sm border border-divider">
              {shares.map((s) => {
                const live = !s.revoked_at && s.expires_at > now;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <span>
                      {s.recipient}
                      <span className="text-label text-fg-muted">
                        {" "}
                        ·{" "}
                        {s.revoked_at
                          ? "revoked"
                          : live
                            ? `expires ${formatWhen(s.expires_at, activeOrg.timezone)}`
                            : "expired"}
                      </span>
                    </span>
                    {live ? (
                      <ActionForm
                        action={revokeShareAction.bind(null, id)}
                        submit={`Revoke link for ${s.recipient}`}
                        pendingLabel="Revoking…"
                        className="flex items-start gap-2"
                      >
                        <input type="hidden" name="id" value={s.id} />
                      </ActionForm>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      </div>
      <ReportDocument data={report.data} version={report.version} generatedAt={report.generated_at ?? now} />
    </div>
  );
}
