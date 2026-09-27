"use client";

import type { ComponentProps, ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { cn } from "../lib/cn";

/** Dropdown menu (Radix): keyboard navigation, typeahead, Escape, focus return. */
export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  className,
  align = "start",
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-30 min-w-56 overflow-hidden rounded-md border border-divider bg-overlay p-1 shadow-overlay",
          className,
        )}
        {...props}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-3 pt-2 pb-1 text-label font-semibold text-fg-subtle">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-body text-fg outline-none select-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:text-fg-subtle data-[highlighted]:bg-raised",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-divider" />;
}
