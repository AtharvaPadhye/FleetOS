"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@fleetos/ui/components/button";
import { ticketFromException, type TicketFormState } from "@/app/actions/tickets";

/** One-click "Dispatch {vendor}" from the attention queue (PRD OV-2 → EX-4); opens the new ticket. */
export function AttentionDispatch({ exceptionId, label }: { exceptionId: string; label: string }) {
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
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="dispatch" value="1" />
      <Button type="submit" variant="primary" disabled={pending}>
        {label}
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-label text-severity-high">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
