"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@fleetos/ui/components/menu";
import { switchOrganization } from "@/app/actions/org";
import type { OrgSummary } from "@/lib/session";

const ROLE_LABEL: Record<OrgSummary["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  ops: "Operations",
  finance: "Finance",
  viewer: "Viewer",
};

export function OrgSwitcher({ orgs, active }: { orgs: OrgSummary[]; active: OrgSummary }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Menu>
      <MenuTrigger
        className="flex w-full items-center gap-2 rounded-sm border border-divider px-3 py-2.5 text-left hover:bg-raised data-[state=open]:bg-raised"
        aria-label={`Organization: ${active.name}. Switch organization`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-body font-semibold">{active.name}</span>
          <span className="flex items-center gap-2 text-label text-fg-muted">
            {active.city ?? ROLE_LABEL[active.role]}
            {active.isDemo ? <DataSourceBadge source="simulated" /> : null}
          </span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
      </MenuTrigger>
      <MenuContent aria-busy={pending || undefined}>
        <MenuLabel>Organizations</MenuLabel>
        {orgs.map((o) => (
          <MenuItem
            key={o.id}
            onSelect={() =>
              o.id !== active.id &&
              startTransition(async () => {
                await switchOrganization(o.id);
                router.refresh();
              })
            }
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{o.name}</span>
              <span className="text-label text-fg-muted">{ROLE_LABEL[o.role]}</span>
            </span>
            {o.id === active.id ? <Check aria-label="Current organization" /> : null}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => router.push("/onboarding")}>
          <Plus aria-hidden="true" />
          Add organization
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
