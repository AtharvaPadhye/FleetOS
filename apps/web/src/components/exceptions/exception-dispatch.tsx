"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@fleetos/ui/components/button";
import { ticketFromException, type TicketFormState } from "@/app/actions/tickets";

/**
 * EX-4 one-step dispatch: "Dispatch {vendor}" creates the ticket and dispatches the recommended vendor in one
 * request; without a recommendation, a ticket is created and the vendor is picked on the ticket page.
 */
export function ExceptionDispatch({
  exceptionId,
  vendor,
}: {
  exceptionId: string;
  vendor: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<TicketFormState, FormData>(
    async (prev, form) => {
      const r = await ticketFromException(exceptionId, prev, form);
      if (r.status === "ok" && r.number) router.push(`/service/${r.number}`);
      return r;
    },
    { status: "idle" },
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {vendor ? (
          <form action={action}>
            <input type="hidden" name="dispatch" value="1" />
            <input type="hidden" name="vendor_id" value={vendor.id} />
            <Button type="submit" variant="primary" disabled={pending}>
              Dispatch {vendor.name}
            </Button>
          </form>
        ) : null}
        <form action={action}>
          <Button type="submit" variant={vendor ? "secondary" : "primary"} disabled={pending}>
            {vendor ? "Create ticket, pick vendor later" : "Create ticket and choose a vendor"}
          </Button>
        </form>
      </div>
      <p aria-live="polite" className="min-h-5 text-label">
        {state.status === "error" ? (
          <span role="alert" className="text-severity-high">
            {state.message}
          </span>
        ) : state.status === "ok" ? (
          <span className="text-fg-muted">{state.done}.</span>
        ) : null}
      </p>
    </div>
  );
}
