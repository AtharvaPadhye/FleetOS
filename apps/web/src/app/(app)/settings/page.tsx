import type { Metadata } from "next";
import { ActionForm } from "@/components/settings/action-form";
import { ReadonlyNote } from "@/components/settings/readonly-note";
import { saveOrgSettings } from "@/app/actions/settings";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getOrg } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Settings · Organization" };

const input =
  "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg disabled:opacity-60 lg:h-9";
const ZONES = [
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
];

/** ST-1: organization details and fleet targets; every change is audited and KPIs use it on the next load. */
export default async function OrgSettingsPage() {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const o = await getOrg(await createClient(), activeOrg);
  const canEdit = ["owner", "admin"].includes(activeOrg.role);
  const field = (id: string, label: string, control: React.ReactNode, help?: string) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {label}
      </label>
      {control}
      {help ? <p className="text-label text-fg-muted">{help}</p> : null}
    </div>
  );
  return (
    <section aria-labelledby="org" className="flex max-w-2xl flex-col gap-4">
      <h2 id="org" className="text-title font-semibold">
        Organization
      </h2>
      {canEdit ? null : <ReadonlyNote />}
      <ActionForm action={saveOrgSettings} submit="Save changes" disabled={!canEdit}>
        <fieldset disabled={!canEdit} className="flex flex-col gap-4">
          {field(
            "name",
            "Name",
            <input id="name" name="name" defaultValue={o.name} maxLength={120} className={input} />,
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "timezone",
              "Time zone",
              <select id="timezone" name="timezone" defaultValue={o.timezone} className={input}>
                {[...new Set([o.timezone, ...ZONES])].map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>,
              'Days, hours and "today" follow it.',
            )}
            {field(
              "currency",
              "Currency",
              <input id="currency" value={o.currency} readOnly disabled className={input} />,
              "Fixed once revenue is imported, so amounts stay comparable.",
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {field(
              "availability_target",
              "Availability target (%)",
              <input
                id="availability_target"
                name="availability_target"
                inputMode="decimal"
                defaultValue={Math.round(o.availability_target * 1000) / 10}
                className={input}
              />,
            )}
            {field(
              "service_start",
              "Service window starts",
              <input
                id="service_start"
                name="service_start"
                type="time"
                defaultValue={o.service_start}
                className={input}
              />,
            )}
            {field(
              "service_end",
              "Service window ends",
              <input
                id="service_end"
                name="service_end"
                defaultValue={o.service_end}
                pattern="\d{2}:\d{2}"
                placeholder="24:00"
                className={input}
              />,
              "Hours outside it don't count toward availability.",
            )}
          </div>
          {field(
            "reserve",
            "Maintenance reserve per car ($/month)",
            <input
              id="reserve"
              name="reserve"
              inputMode="decimal"
              defaultValue={(o.maintenance_reserve_monthly_cents / 100).toFixed(2)}
              className={`${input} sm:w-48`}
            />,
            "Money set aside for repairs; reports show whether it's funded.",
          )}
        </fieldset>
      </ActionForm>
      <p className="text-label text-fg-muted">
        Battery thresholds and the charge target are under Rules &amp; policies.
      </p>
    </section>
  );
}
