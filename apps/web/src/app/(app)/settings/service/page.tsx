import type { Metadata } from "next";
import { ActionForm } from "@/components/settings/action-form";
import { ReadonlyNote } from "@/components/settings/readonly-note";
import { saveSlaForm } from "@/app/actions/settings";
import { TICKET_TYPE_LABEL } from "@/lib/service-view";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listSlaPolicies } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Settings · Service" };
const input = "h-11 w-24 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg tabular-nums lg:h-9";

/** SLA targets per ticket type: new tickets take their clocks from here (PRD SV-2). */
export default async function ServiceSettingsPage() {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const canEdit = ["owner", "admin"].includes(activeOrg.role);
  const sla = await listSlaPolicies(await createClient(), activeOrg);
  return (
    <section aria-labelledby="sla" className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 id="sla" className="text-title font-semibold">
          SLA targets
        </h2>
        <p className="text-label text-fg-muted">
          Response: dispatch to vendor on site. Resolution: ticket opened to service completed. Applies to tickets
          opened from now on; vendors&apos; SLA compliance is measured against it.
        </p>
      </div>
      {canEdit ? null : <ReadonlyNote />}
      <ActionForm action={saveSlaForm} submit="Save SLA targets" disabled={!canEdit}>
        <fieldset disabled={!canEdit}>
          <legend className="sr-only">SLA targets in minutes</legend>
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-label text-fg-muted">
                <th className="py-2 font-medium">Ticket type</th>
                <th className="py-2 font-medium">Response (min)</th>
                <th className="py-2 font-medium">Resolution (min)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {sla.map((p) => (
                <tr key={p.ticket_type}>
                  <th scope="row" className="py-2 text-left font-normal">
                    {TICKET_TYPE_LABEL[p.ticket_type]}
                  </th>
                  <td className="py-2">
                    <input
                      aria-label={`${TICKET_TYPE_LABEL[p.ticket_type]} response minutes`}
                      name={`${p.ticket_type}_response`}
                      inputMode="numeric"
                      defaultValue={p.response_min}
                      className={input}
                    />
                  </td>
                  <td className="py-2">
                    <input
                      aria-label={`${TICKET_TYPE_LABEL[p.ticket_type]} resolution minutes`}
                      name={`${p.ticket_type}_resolution`}
                      inputMode="numeric"
                      defaultValue={p.resolution_min}
                      className={input}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      </ActionForm>
    </section>
  );
}
