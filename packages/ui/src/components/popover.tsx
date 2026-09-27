"use client";

import type { ComponentProps } from "react";
import { Popover as P } from "radix-ui";
import { cn } from "../lib/cn";

/** Anchored popover (design-system Part 3: overlay surface, shadow, radius md). */
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

export function PopoverContent({
  className,
  align = "end",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          // Never taller than the space Radix finds on screen; scroll inside instead of falling off the viewport.
          "z-30 max-h-[var(--radix-popover-content-available-height)] w-64 overflow-y-auto rounded-md border border-divider bg-overlay p-3 text-body shadow-overlay focus:outline-none",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
