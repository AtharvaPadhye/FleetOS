"use client";

import type { ReactNode } from "react";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import { cn } from "../lib/cn";

/** ⌘K palette: cmdk list inside a Radix Dialog (focus trap, Escape, restores focus). */
export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  placeholder: string;
  emptyText: string;
  children: ReactNode;
}

export function CommandDialog({ open, onOpenChange, label, placeholder, emptyText, children }: CommandDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-[var(--fo-scrim)]" />
        <Dialog.Content className="fixed top-[15vh] left-1/2 z-[60] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-md border border-divider bg-overlay shadow-overlay focus:outline-none">
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <Dialog.Description className="sr-only">
            Type to search, use arrow keys to move, Enter to open.
          </Dialog.Description>
          <Command label={label} className="flex flex-col">
            <Command.Input
              placeholder={placeholder}
              className="h-12 w-full border-b border-divider bg-transparent px-4 text-body text-fg placeholder:text-fg-subtle focus:outline-none"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-body text-fg-muted">{emptyText}</Command.Empty>
              {children}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CommandGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-label [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-subtle"
    >
      {children}
    </Command.Group>
  );
}

export interface CommandItemProps {
  value: string;
  keywords?: string[];
  onSelect?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function CommandItem({ value, keywords, onSelect, disabled, className, children }: CommandItemProps) {
  return (
    <Command.Item
      value={value}
      {...(keywords ? { keywords } : {})}
      {...(onSelect ? { onSelect } : {})}
      disabled={disabled ?? false}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-body text-fg",
        "data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-fg-subtle data-[selected=true]:bg-raised",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
        className,
      )}
    >
      {children}
    </Command.Item>
  );
}
