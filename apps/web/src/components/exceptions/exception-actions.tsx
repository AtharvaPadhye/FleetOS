"use client";

import { useActionState } from "react";
import type { ExceptionStatus } from "@fleetos/domain";
import { Button } from "@fleetos/ui/components/button";
import { changeException, type ExceptionActionState } from "@/app/actions/exceptions";

/** What someone can do with an exception from here (owner / admin / ops). Dispatch arrives with tickets (5.5). */
export function ExceptionActions({
  id,
  status,
  ownedByMe,
  hasOwner,
}: {
  id: string;
  status: ExceptionStatus;
  ownedByMe: boolean;
  hasOwner: boolean;
}) {
  const [state, action, pending] = useActionState<ExceptionActionState, FormData>(changeException.bind(null, id), {
    status: "idle",
  });
  const closed = status === "resolved" || status === "dismissed";
  const intents: { intent: string; label: string; primary?: boolean }[] = closed
    ? [{ intent: "reopen", label: "Reopen" }]
    : [
        ...(ownedByMe
          ? [{ intent: "unassign", label: "Unassign me" }]
          : [{ intent: "assign_me", label: hasOwner ? "Take over" : "Assign to me" }]),
        ...(status !== "in_progress" ? [{ intent: "start", label: "Start work" }] : []),
        { intent: "resolve", label: "Resolve", primary: true },
        { intent: "dismiss", label: "Dismiss" },
      ];
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`note-${id}`} className="text-label font-medium">
          Note <span className="font-normal text-fg-muted">(optional; required to dismiss)</span>
        </label>
        <textarea
          id={`note-${id}`}
          name="note"
          rows={2}
          maxLength={2000}
          className="rounded-sm border border-border-control bg-canvas px-3 py-2 text-body text-fg"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {intents.map((i) => (
          <Button
            key={i.intent}
            type="submit"
            name="intent"
            value={i.intent}
            variant={i.primary ? "primary" : "secondary"}
            disabled={pending}
          >
            {i.label}
          </Button>
        ))}
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
    </form>
  );
}
