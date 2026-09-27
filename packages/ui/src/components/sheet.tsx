"use client";

import type { ComponentProps, ReactNode } from "react";
import { Dialog } from "radix-ui";
import { cn } from "../lib/cn";

/**
 * Side panel on a scrim (Radix Dialog: focus trap, Escape to close, focus returns to the trigger).
 * Used for navigation below 1024px and later for Copilot and record drawers.
 */
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export interface SheetContentProps extends ComponentProps<typeof Dialog.Content> {
  side?: "left" | "right";
  title: string;
  description?: string;
  children: ReactNode;
}

export function SheetContent({ side = "left", title, description, className, children, ...props }: SheetContentProps) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-[var(--fo-scrim)]" />
      <Dialog.Content
        className={cn(
          "fixed inset-y-0 z-40 flex w-72 max-w-[85vw] flex-col border-divider bg-surface shadow-overlay focus:outline-none",
          side === "left" ? "left-0 border-r" : "right-0 border-l",
          className,
        )}
        {...props}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        {description ? (
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
        ) : (
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
        )}
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
