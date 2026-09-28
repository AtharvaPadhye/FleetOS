"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@fleetos/ui/components/button";
import { Dialog, DialogContent, DialogTrigger } from "@fleetos/ui/components/dialog";
import { saveHubForm, type HubFormState } from "@/app/actions/hubs";

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const MI = 1609.344;

export interface HubFormValues {
  id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  chargers: number;
  charger_kw: number | null;
  bays: { cleaning: number; maintenance: number; parking: number };
  price_cents: number | null;
}

/** Add or edit a hub (PRD HB-5): a radius around a point (polygon drawing comes with Settings), chargers, bays, price. */
export function HubFormDialog({ hub }: { hub?: HubFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<HubFormState, FormData>(
    async (prev, form) => {
      const r = await saveHubForm(hub?.id ?? null, prev, form);
      if (r.status === "ok") {
        setOpen(false);
        router.push(`/hubs/${r.id}`);
        router.refresh();
      }
      return r;
    },
    { status: "idle" },
  );
  const echo = state.status === "error" ? state.values : null;
  const val = (k: string, d: string | number | null | undefined) =>
    echo ? (echo[k] ?? "") : d == null ? "" : String(d);
  const field = (
    k: string,
    label: string,
    d: string | number | null | undefined,
    mode: "text" | "decimal" | "numeric" = "text",
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`h-${k}`} className="text-label font-medium">
        {label}
      </label>
      <input id={`h-${k}`} name={k} inputMode={mode} defaultValue={val(k, d)} className={input} />
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={hub ? "secondary" : "primary"}>
          {hub ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />} {hub ? "Edit hub" : "Add hub"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={hub ? `Edit ${hub.name}` : "Add a hub"}
        description="Cars inside the radius count as at this hub."
      >
        <form action={action} className="flex flex-col gap-4" noValidate>
          {field("name", "Name", hub?.name)}
          {field("address", "Address (optional)", hub?.address)}
          <div className="grid gap-3 sm:grid-cols-3">
            {field("lat", "Latitude", hub?.lat, "decimal")}
            {field("lng", "Longitude", hub?.lng, "decimal")}
            {field("radius_ft", "Radius (ft)", hub ? Math.round((hub.radius_m / MI) * 5280) : 500, "numeric")}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {field("chargers", "Chargers", hub?.chargers ?? 0, "numeric")}
            {field("charger_kw", "Power per charger (kW)", hub?.charger_kw ?? 72, "decimal")}
            {field("price_cents", "Electricity (¢/kWh, flat)", hub?.price_cents ?? "", "decimal")}
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-1 text-label font-medium">Bays</legend>
            {field("bays_cleaning", "Cleaning", hub?.bays.cleaning ?? 0, "numeric")}
            {field("bays_maintenance", "Maintenance", hub?.bays.maintenance ?? 0, "numeric")}
            {field("bays_parking", "Parking", hub?.bays.parking ?? 0, "numeric")}
          </fieldset>
          <p className="text-label text-fg-muted">
            Leave the price empty to keep the current tariff. A price replaces it with an all-day rate; time-of-use
            rates are edited in Settings.
          </p>
          {state.status === "error" ? (
            <p role="alert" className="rounded-sm border border-severity-high px-3 py-2 text-body">
              {state.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : hub ? "Save changes" : "Add hub"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
