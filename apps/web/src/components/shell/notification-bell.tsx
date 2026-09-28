"use client";

import { useEffect, useState, useTransition } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { SEVERITY_META } from "@fleetos/ui/components/severity-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@fleetos/ui/components/popover";
import { cn } from "@fleetos/ui/lib/cn";
import { markAllRead, markOneRead, recentNotifications } from "@/app/actions/notifications";
import { subscribeUserNotifications } from "@/lib/realtime/org-channel";
import type { NotificationOut } from "@/lib/services/notifications";

const age = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1
    ? "just now"
    : m < 90
      ? `${m} min ago`
      : m < 36 * 60
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
};

/**
 * The bell (PRD GL-5): unread critical/high items and your ticket updates. New ones arrive over the user's
 * private realtime topic, so the badge moves without a reload; opening lists the newest 20 with links.
 */
export function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationOut[] | null>(null);
  const [pending, start] = useTransition();
  // A fresh server count (after navigation or refresh) replaces the local one.
  const [serverCount, setServerCount] = useState(initialUnread);
  if (serverCount !== initialUnread) {
    setServerCount(initialUnread);
    setUnread(initialUnread);
  }
  useEffect(
    () =>
      subscribeUserNotifications(userId, (event, payload) => {
        if (event !== "notification") return;
        const sev = (payload as { severity?: string }).severity;
        if (sev === "critical" || sev === "high") setUnread((n) => n + 1);
        setItems(null); // refetch on next open
      }),
    [userId],
  );
  const load = () => start(async () => setItems(await recentNotifications()));
  return (
    <Popover onOpenChange={(open) => open && load()}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative inline-flex size-11 items-center justify-center rounded-full border border-border-control hover:bg-raised lg:size-9"
        >
          <Bell aria-hidden="true" className="size-4" />
          {unread ? (
            <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-chalk px-1 text-center text-label font-semibold text-chalk-fg tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b border-divider px-3 py-2">
          <span className="text-label font-semibold">Notifications</span>
          <button
            type="button"
            className="text-label text-fg-muted underline underline-offset-4 disabled:no-underline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markAllRead();
                setUnread(0);
                setItems((xs) => xs?.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) ?? null);
                router.refresh();
              })
            }
          >
            Mark all read
          </button>
        </div>
        {items === null ? (
          <p className="p-3 text-label text-fg-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-3 text-label text-fg-muted">
            Nothing yet. Critical and high-severity issues and your tickets show here.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-divider overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <Link
                  href={(n.href ?? "/") as Route}
                  onClick={() => {
                    if (!n.read_at) {
                      void markOneRead(n.id);
                      if (n.severity === "critical" || n.severity === "high" || n.kind === "ticket_update")
                        setUnread((u) => Math.max(0, u - 1));
                    }
                  }}
                  className={cn("flex flex-col gap-0.5 px-3 py-2 hover:bg-raised", !n.read_at && "bg-raised/50")}
                >
                  <span className="flex items-center gap-2 text-body">
                    <span aria-hidden="true" className={SEVERITY_META[n.severity].className}>
                      {SEVERITY_META[n.severity].glyph}
                    </span>
                    <span className={cn(!n.read_at && "font-semibold")}>{n.title}</span>
                    {!n.read_at ? <span className="sr-only">(unread)</span> : null}
                  </span>
                  <span className="text-label text-fg-muted">
                    {[n.body, age(n.created_at)].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-divider px-3 py-2">
          <Link href="/settings/notifications" className="text-label text-fg-muted underline underline-offset-4">
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
