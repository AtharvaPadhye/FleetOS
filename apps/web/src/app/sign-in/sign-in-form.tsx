"use client";

import { useActionState } from "react";
import { Button } from "@fleetos/ui/components/button";
import { signInWithEmail, type SignInState } from "@/app/actions/auth";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInWithEmail, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h2 className="text-title font-semibold">Check your email</h2>
        <p className="text-fg-muted">
          We sent a sign-in link to <strong className="text-fg">{state.email}</strong>. Open it on this device to
          continue.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-label font-medium">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={state.status === "error" ? "email-error" : undefined}
          aria-invalid={state.status === "error" || undefined}
          className="h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          placeholder="you@company.com"
        />
        {state.status === "error" ? (
          <p id="email-error" role="alert" className="text-label text-severity-critical">
            {state.message}
          </p>
        ) : null}
      </div>
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Sending link…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
