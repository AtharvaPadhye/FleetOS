"use client";

import { useState, useTransition } from "react";
import { Button } from "@fleetos/ui/components/button";
import { Dialog, DialogContent, DialogTrigger } from "@fleetos/ui/components/dialog";
import { applyHubRecommendation } from "@/app/actions/hubs";

/**
 * Apply with a confirmation that lists the concrete effects (flows.md F6). Routing and charge limits are manual
 * steps until dispatch and vehicle commands exist (Phase 7); FleetOS records the decision and re-forecasts.
 */
export function ApplyRecommendation({
  hubId,
  rec,
}: {
  hubId: string;
  rec: { id: string; title: string; detail: string; kind: "route" | "delay" };
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">Apply</Button>
      </DialogTrigger>
      <DialogContent title={rec.title} description="Confirm to record this plan and update the forecast.">
        <div className="flex flex-col gap-4">
          <p>{rec.detail}</p>
          <p className="rounded-sm border border-divider p-3 text-label text-fg-muted">
            {rec.kind === "route"
              ? "Send these cars to the other hub after their current trip. Until dispatch is connected, do this in the Tesla app; FleetOS records the plan and moves their charging in the forecast."
              : "Hold charging for these cars until the window ends (lower their charge start in the Tesla app until vehicle commands are connected). FleetOS records the plan and moves their charging in the forecast."}
          </p>
          {error ? (
            <p role="alert" className="text-body text-severity-high">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await applyHubRecommendation(hubId, rec.id);
                  if (r.status === "error") setError(r.message);
                  else setOpen(false);
                })
              }
            >
              {pending ? "Applying…" : "Confirm plan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
