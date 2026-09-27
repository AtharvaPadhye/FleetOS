"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Columns3 } from "lucide-react";
import { Button } from "@fleetos/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@fleetos/ui/components/popover";
import { saveFleetPreferences } from "@/app/actions/fleet";
import { FLEET_COLUMNS, type FleetColumnKey } from "@/lib/fleet-view";

/** Column chooser + row density (PRD FL-3); saved to the user's profile so it follows them across devices. */
export function ColumnChooser({
  visible,
  density,
  canSeeMoney,
}: {
  visible: FleetColumnKey[];
  density: "default" | "compact";
  canSeeMoney: boolean;
}) {
  const router = useRouter();
  const [cols, setCols] = useState<FleetColumnKey[]>(visible);
  const [dens, setDens] = useState(density);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      try {
        setError(null);
        await saveFleetPreferences({ columns: cols, density: dens });
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <Columns3 aria-hidden="true" /> Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Table columns and density" className="w-72">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-label font-medium text-fg-muted">Columns</legend>
          {FLEET_COLUMNS.map((c) => {
            const locked = c.money && !canSeeMoney;
            return (
              <label
                key={c.key}
                className="flex min-h-9 items-center gap-2 rounded-sm px-1 hover:bg-raised aria-disabled:opacity-50"
                aria-disabled={locked}
                title={locked ? "Needs money access (owner, admin or finance)" : undefined}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--fo-chalk)]"
                  disabled={locked}
                  checked={!locked && cols.includes(c.key)}
                  onChange={(e) =>
                    setCols((prev) => (e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key)))
                  }
                />
                {c.label}
              </label>
            );
          })}
        </fieldset>
        <fieldset className="mt-3 flex flex-col gap-1 border-t border-divider pt-3">
          <legend className="mb-1 text-label font-medium text-fg-muted">Row height</legend>
          {(["default", "compact"] as const).map((d) => (
            <label key={d} className="flex min-h-9 items-center gap-2 rounded-sm px-1 hover:bg-raised">
              <input
                type="radio"
                name="density"
                className="size-4 accent-[var(--fo-chalk)]"
                checked={dens === d}
                onChange={() => setDens(d)}
              />
              {d === "default" ? "Comfortable" : "Compact"}
            </label>
          ))}
        </fieldset>
        {error ? (
          <p role="alert" className="mt-2 text-label text-severity-critical">
            {error}
          </p>
        ) : null}
        <Button className="mt-3 w-full" variant="primary" size="sm" onClick={save} disabled={pending || !cols.length}>
          {pending ? "Saving…" : "Save view"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
