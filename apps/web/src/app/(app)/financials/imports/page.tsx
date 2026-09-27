import type { Metadata, Route } from "next";
import Link from "next/link";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Import payouts" };

const STATUS = {
  validating: "Checking",
  ready: "Ready to commit",
  imported: "Imported",
  failed: "Needs fixing",
} as const;

export default async function ImportsPage() {
  const { activeOrg } = await getAppContext();
  if (!activeOrg || !["owner", "admin", "finance"].includes(activeOrg.role)) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Import payouts" summary="Book revenue from ride-platform payout statements." />
        <EmptyState
          title="Finance access needed"
          description="Only owners, admins and finance can import revenue. Ask an admin to change your role."
        />
      </div>
    );
  }
  const supabase = await createClient();
  const { data: imports } = await supabase
    .from("revenue_imports")
    .select("id, filename, status, rows_total, rows_valid, rows_imported, created_at")
    .eq("org_id", activeOrg.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Import payouts"
        summary="Book revenue from ride-platform payout statements until a live earnings feed exists."
      />
      <section className="rounded-md border border-divider bg-surface p-6">
        <UploadForm />
      </section>
      <section aria-labelledby="history" className="flex flex-col gap-3">
        <h2 id="history" className="text-title font-semibold">
          Recent imports
        </h2>
        {imports?.length ? (
          <div
            className="overflow-x-auto rounded-md border border-divider"
            role="region"
            aria-label="Recent imports"
            tabIndex={0}
          >
            <table className="w-full min-w-[36rem] text-body">
              <thead className="border-b border-divider bg-raised">
                <tr>
                  {["File", "Status", "Rows", "Booked", "Uploaded"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2 text-left text-label font-medium text-fg-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td className="px-4 py-2">
                      <Link href={`/financials/imports/${i.id}` as Route} className="underline underline-offset-4">
                        {i.filename}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{STATUS[i.status as keyof typeof STATUS]}</td>
                    <td className="px-4 py-2">
                      {i.rows_valid} of {i.rows_total} valid
                    </td>
                    <td className="px-4 py-2">{i.rows_imported ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-mono text-fg-muted">
                      {new Date(i.created_at).toLocaleString("en-US", { timeZone: activeOrg.timezone })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-fg-muted">No imports yet.</p>
        )}
      </section>
    </div>
  );
}
