import type { Metadata } from "next";
import { getAppContext } from "@/lib/session";

export const metadata: Metadata = { title: "Settings · Billing" };

/** ST-7: placeholder in this release; states the plan, no dead buttons. */
export default async function BillingPage() {
  const { activeOrg } = await getAppContext();
  return (
    <section
      aria-labelledby="billing"
      className="flex max-w-2xl flex-col gap-2 rounded-md border border-divider bg-surface p-6"
    >
      <h2 id="billing" className="text-title font-semibold">
        Billing
      </h2>
      <p>{activeOrg?.isDemo ? "Demo organization" : "Early access"}: no charge during the pilot.</p>
      <p className="text-fg-muted">Billing is coming soon. Nothing here needs your attention.</p>
    </section>
  );
}
