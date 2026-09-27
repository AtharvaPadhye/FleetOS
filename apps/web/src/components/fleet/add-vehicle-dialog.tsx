"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@fleetos/ui/components/button";
import { Dialog, DialogContent, DialogTrigger } from "@fleetos/ui/components/dialog";
import { addVehicle, type AddVehicleState } from "@/app/actions/fleet";

const input =
  "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg aria-invalid:border-severity-critical lg:h-9";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-label text-severity-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-label text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Add a vehicle by hand (owner/admin, PRD FL-5). Tesla-connected fleets add cars in Phase 4. */
export function AddVehicleDialog({ hubs }: { hubs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<AddVehicleState, FormData>(
    async (prev, form) => {
      const result = await addVehicle(prev, form);
      if (result.status === "ok") {
        setOpen(false);
        router.push(`/fleet/${result.number}` as Parameters<typeof router.push>[0]);
      }
      return result;
    },
    { status: "idle" },
  );
  const err = state.status === "error" ? (state.fields ?? {}) : {};
  const val = (k: string) => (state.status === "error" ? state.values[k] : undefined);
  const aria = (name: string) =>
    err[name] ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` } : {};
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus aria-hidden="true" /> Add vehicle
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a vehicle"
        description="It shows as Offline until live data arrives. Connecting Tesla (coming soon) adds cars automatically."
      >
        <form action={action} className="flex flex-col gap-4" noValidate>
          <Field
            id="vin"
            label="VIN"
            hint="17 letters and digits, from the windshield or registration."
            error={err.vin}
          >
            <input
              id="vin"
              name="vin"
              defaultValue={val("vin")}
              required
              autoComplete="off"
              spellCheck={false}
              maxLength={17}
              className={`${input} font-mono uppercase`}
              {...aria("vin")}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="number" label="Fleet number" hint="Shown everywhere, e.g. 085." error={err.number}>
              <input
                id="number"
                name="number"
                defaultValue={val("number")}
                required
                maxLength={12}
                className={input}
                {...aria("number")}
              />
            </Field>
            <Field id="display_name" label="Name (optional)" error={err.display_name}>
              <input
                id="display_name"
                name="display_name"
                defaultValue={val("display_name")}
                maxLength={60}
                className={input}
                {...aria("display_name")}
              />
            </Field>
          </div>
          <Field id="home_hub_id" label="Home hub" error={err.home_hub_id}>
            <select
              id="home_hub_id"
              name="home_hub_id"
              className={input}
              defaultValue={val("home_hub_id") ?? ""}
              {...aria("home_hub_id")}
            >
              <option value="">No home hub</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-label text-fg-muted">
              Monthly fixed costs, spread over each day the car is in the fleet (optional)
            </legend>
            <Field id="insurance" label="Insurance ($/month)" error={err.insurance}>
              <input
                id="insurance"
                name="insurance"
                defaultValue={val("insurance")}
                inputMode="decimal"
                placeholder="486.00"
                className={input}
                {...aria("insurance")}
              />
            </Field>
            <Field id="financing" label="Financing ($/month)" error={err.financing}>
              <input
                id="financing"
                name="financing"
                defaultValue={val("financing")}
                inputMode="decimal"
                placeholder="1143.00"
                className={input}
                {...aria("financing")}
              />
            </Field>
          </fieldset>
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
              {pending ? "Adding…" : "Add vehicle"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
