"use client";

import { useActionState } from "react";
import { Button } from "@fleetos/ui/components/button";
import { sendTest } from "@/app/actions/notifications";
import type { SettingsState } from "@/app/actions/settings";

/** "Send test" (flows.md ST-6): a notification to you, and to Slack when connected. */
export function SendTestButton() {
  const [state, run, pending] = useActionState(sendTest, { status: "idle" } as SettingsState);
  return (
    <form action={run} className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send test"}
      </Button>
      <p aria-live="polite" className="text-label text-fg-muted">
        {state.status === "error" ? (
          <span role="alert" className="text-severity-high">
            {state.message}
          </span>
        ) : state.status === "ok" ? (
          `${state.message}.`
        ) : null}
      </p>
    </form>
  );
}
