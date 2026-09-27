import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@fleetos/ui/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getVehicleDetail } from "@/lib/services/vehicle-detail";

export async function generateMetadata({ params }: PageProps<"/fleet/[number]">): Promise<Metadata> {
  return { title: `Cybercab ${(await params).number}` };
}

/** Vehicle page. Task 5.2 fills in the map, tabs, telemetry, timeline and P&L; this shows the essentials. */
export default async function VehiclePage({ params }: PageProps<"/fleet/[number]">) {
  const { number } = await params;
  const { activeOrg } = await getAppContext();
  if (!activeOrg) notFound();
  let v;
  try {
    v = await getVehicleDetail(await createClient(), activeOrg, { number: decodeURIComponent(number) });
  } catch (e) {
    if (e instanceof ApiProblem && e.code === "not_found") notFound();
    throw e;
  }
  return (
    <div className="flex flex-col gap-6">
      <Link href="/fleet" className="text-label text-fg-muted underline underline-offset-4">
        ← Fleet
      </Link>
      <PageHeader title={v.display_name ?? `Cybercab ${v.number}`} summary={`VIN ${v.vin}`} />
      <StatusBadge status={v.state.status} />
      <p className="text-fg-muted">The full vehicle page (map, telemetry, timeline and P&amp;L) arrives in task 5.2.</p>
    </div>
  );
}
