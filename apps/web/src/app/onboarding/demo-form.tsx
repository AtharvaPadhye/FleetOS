"use client";

import { useActionState } from "react";
import { Button } from "@fleetos/ui/components/button";
import { createDemoOrganization, type CreateOrgState } from "@/app/actions/org";

export function DemoForm() {
  const [state, action, pending] = useActionState<CreateOrgState, FormData>(() => createDemoOrganization(), {
    status: "idle",
  });
  return (
    <form action={action} className="flex flex-col gap-3">
      <Button type="submit" variant="secondary" size="lg" disabled={pending}>
        {pending ? "Setting up 84 Cybercabs…" : "Explore with a demo fleet"}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="text-label text-severity-critical">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
