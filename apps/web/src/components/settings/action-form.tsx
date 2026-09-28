"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@fleetos/ui/components/button";
import type { SettingsState } from "@/app/actions/settings";

/** A settings form bound to a server action, with its result announced next to the button. */
export function ActionForm({
  action,
  submit,
  children,
  className,
  disabled,
}: {
  action: (prev: SettingsState, form: FormData) => Promise<SettingsState>;
  submit: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [state, run, pending] = useActionState(action, { status: "idle" } as SettingsState);
  return (
    <form action={run} className={className ?? "flex flex-col gap-4"} noValidate>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        {disabled ? null : (
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : submit}
          </Button>
        )}
        <p aria-live="polite" className="text-label">
          {state.status === "error" ? (
            <span role="alert" className="text-severity-high">
              {state.message}
            </span>
          ) : state.status === "ok" ? (
            <span className="text-fg-muted">{state.message}.</span>
          ) : null}
        </p>
      </div>
      {state.status === "ok" && state.link ? (
        <p className="flex flex-col gap-1 text-label">
          <span className="text-fg-muted">Invitation link (works for 7 days):</span>
          <input
            readOnly
            value={state.link}
            aria-label="Invitation link"
            className="h-9 rounded-sm border border-border-control bg-canvas px-2 font-mono text-mono"
          />
        </p>
      ) : null}
    </form>
  );
}
