"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { subscribeOrgChannel } from "@/lib/realtime/org-channel";

/**
 * Keeps a server-rendered page current: when the engine broadcasts new vehicle state for the org, refresh the
 * page's server data (at most once per `minIntervalMs`). Client state (open menus, typed input) survives.
 */
export function LiveRefresh({ orgId, minIntervalMs = 10_000 }: { orgId: string; minIntervalMs?: number }) {
  const router = useRouter();
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const refresh = () => {
      last.current = Date.now();
      pending.current = null;
      router.refresh();
    };
    const off = subscribeOrgChannel(orgId, "vehicles", (event) => {
      if (event !== "state" || pending.current) return;
      const wait = Math.max(0, last.current + minIntervalMs - Date.now());
      pending.current = setTimeout(refresh, wait);
    });
    return () => {
      off();
      if (pending.current) clearTimeout(pending.current);
    };
  }, [orgId, minIntervalMs, router]);
  return null;
}
