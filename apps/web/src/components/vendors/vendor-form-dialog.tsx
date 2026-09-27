"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { VENDOR_CATEGORIES, VENDOR_CATEGORY_LABEL, type VendorCategory } from "@fleetos/domain";
import { Button } from "@fleetos/ui/components/button";
import { Dialog, DialogContent, DialogTrigger } from "@fleetos/ui/components/dialog";
import { saveVendor, type VendorFormState } from "@/app/actions/vendors";

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const MI = 1609.344;

export interface VendorFormValues {
  id: string;
  name: string;
  categories: VendorCategory[];
  status: "active" | "limited" | "inactive";
  contact: { name: string | null; phone: string | null; email: string | null };
  base_location: { lat: number; lng: number } | null;
  service_radius_m: number | null;
  pricing: Record<string, number>;
  sla_response_min: number | null;
  sla_resolution_min: number | null;
  capacity_note: string | null;
}

/** Add or edit a vendor (PRD VN-3). Prices are per job, per category; the service area is a radius around the base. */
export function VendorFormDialog({ vendor }: { vendor?: VendorFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<VendorCategory[]>(vendor?.categories ?? []);
  const [state, action, pending] = useActionState<VendorFormState, FormData>(
    async (prev, form) => {
      const r = await saveVendor(vendor?.id ?? null, prev, form);
      if (r.status === "ok") {
        setOpen(false);
        router.push(`/vendors/${r.slug}` as Parameters<typeof router.push>[0]);
        router.refresh();
      }
      return r;
    },
    { status: "idle" },
  );
  const echo = state.status === "error" ? state.values : null;
  const val = (k: string, fallback: string | number | null | undefined) =>
    echo ? String(echo[k] ?? "") : fallback === null || fallback === undefined ? "" : String(fallback);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={vendor ? "secondary" : "primary"}>
          {vendor ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />} {vendor ? "Edit vendor" : "Add vendor"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={vendor ? `Edit ${vendor.name}` : "Add a vendor"}
        description="Vendors are ranked for a job by ETA, price and SLA record."
      >
        <form action={action} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="v-name" className="text-label font-medium">
              Name
            </label>
            <input
              id="v-name"
              name="name"
              required
              maxLength={80}
              defaultValue={val("name", vendor?.name)}
              className={input}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-label font-medium">Categories</legend>
            <div className="grid grid-cols-2 gap-1">
              {VENDOR_CATEGORIES.map((c) => (
                <label key={c} className="flex min-h-11 items-center gap-2 rounded-sm px-1 hover:bg-raised lg:min-h-9">
                  <input
                    type="checkbox"
                    name="categories"
                    value={c}
                    className="size-4 accent-[var(--fo-chalk)]"
                    checked={cats.includes(c)}
                    onChange={(e) => setCats((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))}
                  />
                  {VENDOR_CATEGORY_LABEL[c]}
                </label>
              ))}
            </div>
          </fieldset>
          {cats.length ? (
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-label font-medium">Typical price per job ($)</legend>
              {cats.map((c) => (
                <div key={c} className="flex flex-col gap-1.5">
                  <label htmlFor={`v-price-${c}`} className="text-label text-fg-muted">
                    {VENDOR_CATEGORY_LABEL[c]}
                  </label>
                  <input
                    id={`v-price-${c}`}
                    name={`price_${c}`}
                    inputMode="decimal"
                    defaultValue={val(
                      `price_${c}`,
                      vendor?.pricing[c] !== undefined ? (vendor.pricing[c]! / 100).toFixed(2) : "",
                    )}
                    className={input}
                  />
                </div>
              ))}
            </fieldset>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["lat", "Base latitude", vendor?.base_location?.lat],
                ["lng", "Base longitude", vendor?.base_location?.lng],
                [
                  "radius_mi",
                  "Service radius (mi)",
                  vendor?.service_radius_m ? Math.round((vendor.service_radius_m / MI) * 10) / 10 : "",
                ],
              ] as const
            ).map(([k, label, v]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <label htmlFor={`v-${k}`} className="text-label font-medium">
                  {label}
                </label>
                <input id={`v-${k}`} name={k} inputMode="decimal" defaultValue={val(k, v)} className={input} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="v-status" className="text-label font-medium">
                Availability
              </label>
              <select
                id="v-status"
                name="status"
                defaultValue={val("status", vendor?.status ?? "active")}
                className={input}
              >
                <option value="active">Available</option>
                <option value="limited">Limited (ranked lower)</option>
                <option value="inactive">Inactive (not ranked)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="v-resp" className="text-label font-medium">
                Response SLA (min)
              </label>
              <input
                id="v-resp"
                name="sla_response_min"
                inputMode="numeric"
                defaultValue={val("sla_response_min", vendor?.sla_response_min)}
                className={input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="v-res" className="text-label font-medium">
                Resolution SLA (min)
              </label>
              <input
                id="v-res"
                name="sla_resolution_min"
                inputMode="numeric"
                defaultValue={val("sla_resolution_min", vendor?.sla_resolution_min)}
                className={input}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["contact_name", "Contact", vendor?.contact.name, "text"],
                ["contact_phone", "Phone", vendor?.contact.phone, "tel"],
                ["contact_email", "Email", vendor?.contact.email, "email"],
              ] as const
            ).map(([k, label, v, type]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <label htmlFor={`v-${k}`} className="text-label font-medium">
                  {label}
                </label>
                <input id={`v-${k}`} name={k} type={type} defaultValue={val(k, v)} className={input} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="v-cap" className="text-label font-medium">
              Capacity note (optional)
            </label>
            <input
              id="v-cap"
              name="capacity_note"
              maxLength={200}
              placeholder="e.g. 3 crews"
              defaultValue={val("capacity_note", vendor?.capacity_note)}
              className={input}
            />
          </div>
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
              {pending ? "Saving…" : vendor ? "Save changes" : "Add vendor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
