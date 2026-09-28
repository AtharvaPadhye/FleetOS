"use client";

import { useActionState } from "react";
import { Button } from "@fleetos/ui/components/button";
import { acceptInvite, type SettingsState } from "@/app/actions/settings";

export function AcceptInvite({ token }: { token: string }) {
  const [state, run, pending] = useActionState(acceptInvite.bind(null, token), { status: "idle" } as SettingsState);
  return (
    <form action={run} className="flex flex-col gap-3">
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-body text-severity-high">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
