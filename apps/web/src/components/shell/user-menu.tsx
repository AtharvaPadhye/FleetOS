"use client";

import { LogOut, UserRound } from "lucide-react";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@fleetos/ui/components/menu";
import { signOut } from "@/app/actions/auth";

export function UserMenu({ email, roleLabel }: { email: string; roleLabel: string }) {
  return (
    <Menu>
      <MenuTrigger
        className="grid size-9 place-items-center rounded-full border border-border-control text-fg-muted hover:bg-raised hover:text-fg"
        aria-label="Account"
      >
        <UserRound aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Signed in as</MenuLabel>
        <div className="px-3 pb-2">
          <p className="truncate text-body">{email}</p>
          <p className="text-label text-fg-muted">{roleLabel}</p>
        </div>
        <MenuSeparator />
        <MenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
