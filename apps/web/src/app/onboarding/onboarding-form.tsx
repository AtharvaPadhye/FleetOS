"use client";

import { useActionState } from "react";
import { Button } from "@fleetos/ui/components/button";
import { createOrganization, type CreateOrgState } from "@/app/actions/org";

const TIMEZONES = [
  ["America/Phoenix", "Arizona (no daylight saving)"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Denver", "Mountain"],
  ["America/Chicago", "Central"],
  ["America/New_York", "Eastern"],
] as const;

const field =
  "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<CreateOrgState, FormData>(createOrganization, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-label font-medium">
          Organization name
        </label>
        <input id="name" name="name" required maxLength={120} className={field} placeholder="Atlas Mobility" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="city" className="text-label font-medium">
          Main city <span className="font-normal text-fg-muted">(optional)</span>
        </label>
        <input id="city" name="city" maxLength={80} className={field} placeholder="Phoenix, AZ" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="timezone" className="text-label font-medium">
          Time zone
        </label>
        <select id="timezone" name="timezone" defaultValue="America/Phoenix" className={field}>
          {TIMEZONES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <p className="text-label text-fg-muted">Days, shifts and reports follow this time zone.</p>
      </div>
      {state.status === "error" ? (
        <p role="alert" className="text-label text-severity-critical">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
