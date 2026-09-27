"use client";

import type { ComponentProps, ReactNode } from "react";
import { Dialog as D } from "radix-ui";
import { cn } from "../lib/cn";

/** Centred modal (design-system Part 3: overlay shadow, scrim, radius md). Escape and the close button dismiss it. */
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export interface DialogContentProps extends ComponentProps<typeof D.Content> {
  title: string;
  description?: ReactNode;
}

export function DialogContent({ title, description, className, children, ...props }: DialogContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-[var(--fo-scrim)]" />
      <D.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-40 flex max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-md border border-divider bg-overlay p-6 shadow-overlay focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <D.Title className="text-title font-semibold">{title}</D.Title>
            {description ? (
              <D.Description className="text-body text-fg-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{title}</D.Description>
            )}
          </div>
          <D.Close
            aria-label="Close"
            className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-raised hover:text-fg lg:size-9"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
