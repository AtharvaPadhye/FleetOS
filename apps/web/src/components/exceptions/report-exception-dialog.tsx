"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { EXCEPTION_CLASSES, SEVERITIES, type Severity } from "@fleetos/domain";
import { Button } from "@fleetos/ui/components/button";
import { Dialog, DialogContent, DialogTrigger } from "@fleetos/ui/components/dialog";
import { reportException, type ReportState } from "@/app/actions/exceptions";
import { CLASS_LABEL } from "@/lib/exceptions-view";

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Report a problem the rules didn't catch (PRD EX-2 "and manually"). */
export function ReportExceptionDialog({ vehicles, defaultVehicle }: { vehicles: string[]; defaultVehicle?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ReportState, FormData>(
    async (prev, form) => {
      const r = await reportException(prev, form);
      if (r.status === "ok") {
        setOpen(false);
        router.push(`/exceptions/${r.id}`);
      }
      return r;
    },
    { status: "idle" },
  );
  const v = state.status === "error" ? state.values : {};
  const field = (id: string, label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {label}
      </label>
      {control}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus aria-hidden="true" /> Report exception
        </Button>
      </DialogTrigger>
      <DialogContent title="Report an exception" description="For problems the rules didn't catch.">
        <form action={action} className="flex flex-col gap-4" noValidate>
          {field(
            "x-title",
            "What's wrong",
            <input
              id="x-title"
              name="title"
              required
              maxLength={120}
              placeholder="e.g. Rider left a bag in the cabin"
              defaultValue={v.title ?? ""}
              className={input}
            />,
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {field(
              "x-vehicle",
              "Vehicle",
              <select id="x-vehicle" name="vehicle" defaultValue={v.vehicle ?? defaultVehicle ?? ""} className={input}>
                <option value="">No specific vehicle</option>
                {vehicles.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "x-class",
              "Kind",
              <select id="x-class" name="class" defaultValue={v.class ?? "incident"} className={input}>
                {EXCEPTION_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {CLASS_LABEL[c]}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "x-severity",
              "Severity",
              <select id="x-severity" name="severity" defaultValue={v.severity ?? "medium"} className={input}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>,
            )}
          </div>
          {field(
            "x-desc",
            "Details (optional)",
            <textarea
              id="x-desc"
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={v.description ?? ""}
              className="rounded-sm border border-border-control bg-canvas px-3 py-2 text-body text-fg"
            />,
          )}
          <label className="flex min-h-11 items-center gap-2 lg:min-h-9">
            <input
              type="checkbox"
              name="blocks_service"
              defaultChecked={v.blocks_service === "on"}
              className="size-4 accent-[var(--fo-chalk)]"
            />
            Take the vehicle out of service until this is resolved
          </label>
          {state.status === "error" ? (
            <p role="alert" className="rounded-sm border border-severity-high px-3 py-2 text-body">
              {state.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Reporting…" : "Report exception"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
