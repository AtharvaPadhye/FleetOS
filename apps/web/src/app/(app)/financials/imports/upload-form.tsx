"use client";

import { useActionState } from "react";
import { Button } from "@fleetos/ui/components/button";
import { uploadPayoutCsv, type ImportState } from "@/app/actions/revenue-import";

export function UploadForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(uploadPayoutCsv, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="file" className="text-label font-medium">
        Payout statement (CSV, up to 5 MB)
      </label>
      <input
        id="file"
        name="file"
        type="file"
        accept=".csv,text/csv"
        required
        className="text-body text-fg-muted file:mr-3 file:h-9 file:cursor-pointer file:rounded-sm file:border file:border-border-control file:bg-transparent file:px-4 file:text-body file:text-fg"
      />
      <p className="text-label text-fg-muted">
        One row per vehicle per day, with a date, the vehicle (VIN, number or name) and gross earnings. Fees and tips
        are optional. Nothing is booked until you review and commit.
      </p>
      {state.status === "error" ? (
        <p role="alert" className="text-label text-severity-critical">
          {state.message}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Checking file…" : "Upload and check"}
        </Button>
      </div>
    </form>
  );
}
