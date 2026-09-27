"use client";

import { useActionState } from "react";
import type { TicketStatus } from "@fleetos/domain";
import { Button } from "@fleetos/ui/components/button";
import { ticketStep, type TicketFormState } from "@/app/actions/tickets";

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";

export interface VendorChoice {
  id: string;
  name: string;
  eta_min: number | null;
  cost_cents: number | null;
}

function Result({ state }: { state: TicketFormState }) {
  return (
    <p aria-live="polite" className="min-h-5 text-label">
      {state.status === "error" ? (
        <span role="alert" className="text-severity-high">
          {state.message}
        </span>
      ) : state.status === "ok" ? (
        <span className="text-fg-muted">{state.done}.</span>
      ) : null}
    </p>
  );
}

/**
 * The ticket's next step (flows.md F1: one primary action per state), with reassign / escalate / cancel under
 * "More". Every step is a server action that goes through the ticket lifecycle in the database.
 */
export function TicketActions({
  id,
  status,
  vehicleNumber,
  vendors,
  currentVendorId,
  estimateCents,
  blockers,
  canOverride,
}: {
  id: string;
  status: TicketStatus;
  vehicleNumber: string;
  vendors: VendorChoice[];
  currentVendorId: string | null;
  estimateCents: number | null;
  /** Other items that keep the car out of service (names shown when return is blocked). */
  blockers: string[];
  canOverride: boolean;
}) {
  const [state, action, pending] = useActionState<TicketFormState, FormData>(ticketStep.bind(null, id), {
    status: "idle",
  });
  const active = !["completed", "returned", "cancelled"].includes(status);
  const best = vendors[0];
  const vendorPicker = (label: string, submit: string) => (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="action" value="assign-vendor" />
      <div className="flex flex-col gap-1">
        <label htmlFor={`vendor-${submit}`} className="text-label text-fg-muted">
          {label}
        </label>
        <select
          id={`vendor-${submit}`}
          name="vendor_id"
          defaultValue={vendors.find((v) => v.id !== currentVendorId)?.id ?? ""}
          className={input}
        >
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.eta_min !== null ? ` · ETA ${v.eta_min} min` : ""}
              {v.cost_cents !== null ? ` · $${(v.cost_cents / 100).toFixed(0)}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`eta-${submit}`} className="text-label text-fg-muted">
          ETA (min)
        </label>
        <input
          id={`eta-${submit}`}
          name="eta_min"
          inputMode="numeric"
          defaultValue={best?.eta_min ?? ""}
          className={`${input} w-24`}
        />
      </div>
      <Button
        type="submit"
        variant={submit === "primary" ? "primary" : "secondary"}
        disabled={pending || !vendors.length}
      >
        {submit === "primary" ? (best ? `Dispatch ${best.name}` : "Dispatch") : "Reassign"}
      </Button>
    </form>
  );

  return (
    <div className="flex flex-col gap-3">
      {status === "open" ? (
        vendors.length ? (
          vendorPicker("Vendor (best match first)", "primary")
        ) : (
          <p className="text-fg-muted">
            No vendor covers this car&apos;s location for this kind of job. Add one under Vendors.
          </p>
        )
      ) : null}
      {status === "dispatched" || status === "en_route" ? (
        <form action={action}>
          <input type="hidden" name="action" value="mark-arrived" />
          <Button type="submit" variant="primary" disabled={pending}>
            Mark arrived
          </Button>
          <p className="mt-1 text-label text-fg-muted">
            Vendor arrival is entered manually until vendor tracking is connected.
          </p>
        </form>
      ) : null}
      {status === "arrived" || status === "in_progress" ? (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="action" value="complete" />
          <div className="flex flex-col gap-1">
            <label htmlFor="actual_cost" className="text-label text-fg-muted">
              Actual cost ($)
            </label>
            <input
              id="actual_cost"
              name="actual_cost"
              inputMode="decimal"
              required
              defaultValue={estimateCents !== null ? (estimateCents / 100).toFixed(2) : ""}
              className={`${input} w-32`}
            />
          </div>
          <Button type="submit" variant="primary" disabled={pending}>
            Complete service
          </Button>
        </form>
      ) : null}
      {status === "completed" ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="action" value="return-to-service" />
          {blockers.length ? (
            <p className="rounded-sm border border-severity-high px-3 py-2 text-body">
              <span aria-hidden="true">◆ </span>Still blocked by {blockers.join("; ")}.
            </p>
          ) : null}
          {blockers.length && canOverride ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Override</legend>
              <label className="flex min-h-11 items-center gap-2 lg:min-h-9">
                <input type="checkbox" name="override" className="size-4 accent-[var(--fo-chalk)]" />
                Override and return anyway
              </label>
              <label htmlFor="override-reason" className="text-label text-fg-muted">
                Reason (required to override)
              </label>
              <input id="override-reason" name="reason" className={input} />
            </fieldset>
          ) : null}
          <div>
            <Button type="submit" variant="primary" disabled={pending || (blockers.length > 0 && !canOverride)}>
              Return to service
            </Button>
          </div>
        </form>
      ) : null}
      {status === "returned" ? (
        <p className="text-fg-muted">
          Returned to service in FleetOS. Re-enable car {vehicleNumber} in the Tesla app; FleetOS can do it for you once
          dispatch is connected.
        </p>
      ) : null}
      {active ? (
        <details className="rounded-sm border border-divider p-3">
          <summary className="cursor-pointer text-label font-medium">More actions</summary>
          <div className="mt-3 flex flex-col gap-4">
            {status !== "open" && vendors.length ? vendorPicker("Reassign to", "secondary") : null}
            <form action={action} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="action" value="escalate" />
              <div className="flex flex-col gap-1">
                <label htmlFor="escalate-note" className="text-label text-fg-muted">
                  Escalation note
                </label>
                <input id="escalate-note" name="note" className={`${input} w-64`} />
              </div>
              <Button type="submit" disabled={pending}>
                Escalate
              </Button>
            </form>
            <form action={action} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="action" value="cancel" />
              <div className="flex flex-col gap-1">
                <label htmlFor="cancel-reason" className="text-label text-fg-muted">
                  Why cancel
                </label>
                <input id="cancel-reason" name="reason" className={`${input} w-64`} />
              </div>
              <Button type="submit" disabled={pending}>
                Cancel ticket
              </Button>
            </form>
          </div>
        </details>
      ) : null}
      <Result state={state} />
    </div>
  );
}
