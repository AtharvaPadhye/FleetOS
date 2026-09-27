"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { TICKET_TYPES } from "@fleetos/domain";
import { Button } from "@fleetos/ui/components/button";
import { Dialog, DialogContent, DialogTrigger } from "@fleetos/ui/components/dialog";
import { ticketForVehicle, vehicleServiceStep, type TicketFormState } from "@/app/actions/tickets";
import { TICKET_TYPE_LABEL } from "@/lib/service-view";

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";

function Message({ state }: { state: TicketFormState }) {
  return state.status === "error" ? (
    <p role="alert" className="rounded-sm border border-severity-high px-3 py-2 text-body">
      {state.message}
    </p>
  ) : state.status === "ok" ? (
    <p role="status" className="text-label text-fg-muted">
      {state.done}.
    </p>
  ) : null;
}

/**
 * Service controls on the vehicle page: create a ticket (VD-8), pull from service and return to service
 * (vehicle-states.md §5). Returning is refused while something else blocks the car, unless an owner/admin
 * overrides with a reason.
 */
export function VehicleServiceControls({
  vehicleId,
  vehicleNumber,
  held,
  blockers,
  canOverride,
}: {
  vehicleId: string;
  vehicleNumber: string;
  held: boolean;
  blockers: string[];
  canOverride: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"ticket" | "pull" | "return" | null>(null);
  const [ticket, createAction, creating] = useActionState<TicketFormState, FormData>(
    async (prev, form) => {
      const r = await ticketForVehicle(vehicleId, prev, form);
      if (r.status === "ok" && r.number) {
        setOpen(null);
        router.push(`/service/${r.number}`);
      }
      return r;
    },
    { status: "idle" },
  );
  const [step, stepAction, stepping] = useActionState<TicketFormState, FormData>(
    async (prev, form) => {
      const r = await vehicleServiceStep(vehicleId, prev, form);
      if (r.status === "ok") setOpen(null);
      return r;
    },
    { status: "idle" },
  );
  const inService = !held && blockers.length === 0;
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        <Dialog open={open === "ticket"} onOpenChange={(o) => setOpen(o ? "ticket" : null)}>
          <DialogTrigger asChild>
            <Button variant="secondary">Create service ticket</Button>
          </DialogTrigger>
          <DialogContent
            title={`Service ticket for car ${vehicleNumber}`}
            description="You'll pick the vendor on the ticket."
          >
            <form action={createAction} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="t-type" className="text-label font-medium">
                  Kind of service
                </label>
                <select id="t-type" name="type" defaultValue="maintenance" className={input}>
                  {TICKET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TICKET_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="t-desc" className="text-label font-medium">
                  What needs doing
                </label>
                <textarea
                  id="t-desc"
                  name="description"
                  rows={3}
                  maxLength={2000}
                  className="rounded-sm border border-border-control bg-canvas px-3 py-2 text-body text-fg"
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 lg:min-h-9">
                <input type="checkbox" name="blocks_service" className="size-4 accent-[var(--fo-chalk)]" />
                Keep the car out of service until this is done
              </label>
              <Message state={ticket} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={creating}>
                  {creating ? "Creating…" : "Create ticket"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {inService ? (
          <Dialog open={open === "pull"} onOpenChange={(o) => setOpen(o ? "pull" : null)}>
            <DialogTrigger asChild>
              <Button variant="secondary">Pull from service</Button>
            </DialogTrigger>
            <DialogContent
              title={`Pull car ${vehicleNumber} from service`}
              description="It shows as Maintenance until returned."
            >
              <form action={stepAction} className="flex flex-col gap-4" noValidate>
                <input type="hidden" name="step" value="pull" />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="pull-reason" className="text-label font-medium">
                    Reason
                  </label>
                  <input id="pull-reason" name="reason" required minLength={3} className={input} />
                </div>
                <Message state={step} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={stepping}>
                    Pull from service
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ) : (
          <Dialog open={open === "return"} onOpenChange={(o) => setOpen(o ? "return" : null)}>
            <DialogTrigger asChild>
              <Button variant="secondary">Return to service</Button>
            </DialogTrigger>
            <DialogContent title={`Return car ${vehicleNumber} to service`} description="Releases manual holds.">
              <form action={stepAction} className="flex flex-col gap-4" noValidate>
                <input type="hidden" name="step" value="return" />
                {blockers.length ? (
                  <p className="rounded-sm border border-severity-high px-3 py-2 text-body">
                    <span aria-hidden="true">◆ </span>Still blocked by {blockers.join("; ")}.
                    {canOverride ? "" : " Resolve these first, or ask an owner or admin to override."}
                  </p>
                ) : null}
                {blockers.length && canOverride ? (
                  <>
                    <label className="flex min-h-11 items-center gap-2 lg:min-h-9">
                      <input type="checkbox" name="override" className="size-4 accent-[var(--fo-chalk)]" />
                      Override and return anyway
                    </label>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="return-reason" className="text-label font-medium">
                        Reason (required to override)
                      </label>
                      <input id="return-reason" name="reason" className={input} />
                    </div>
                  </>
                ) : null}
                <p className="text-label text-fg-muted">
                  FleetOS updates the car&apos;s status within a minute. Re-enable it in the Tesla app too; FleetOS can
                  do that once dispatch is connected.
                </p>
                <Message state={step} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={stepping || (blockers.length > 0 && !canOverride)}>
                    Return to service
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {open === null ? <Message state={step} /> : null}
    </div>
  );
}
