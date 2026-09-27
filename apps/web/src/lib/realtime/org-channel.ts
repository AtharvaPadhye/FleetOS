"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";

/**
 * One subscription per private org channel (api.md §4), shared by every listener on the page: the freshness
 * chip, LiveRefresh, and later the Bleed counters. Listeners get each broadcast event name and payload.
 *
 * The channel outlives its last listener by a few seconds: React remounts effects (Strict Mode, route
 * changes), and tearing a channel down just to rejoin it made supabase-js hand the new subscriber the channel
 * that was closing, which then reported CLOSED and dropped broadcasts.
 */
type Listener = (event: string, payload: unknown) => void;
type StatusListener = (connected: boolean) => void;

interface Entry {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
  statusListeners: Set<StatusListener>;
  connected: boolean;
  teardown: ReturnType<typeof setTimeout> | null;
  removed: boolean;
}
const entries = new Map<string, Entry>();
const LINGER_MS = 5_000;

function open(topic: string): Entry {
  const supabase = browserClient();
  const channel = supabase.channel(topic, { config: { private: true } });
  const e: Entry = {
    channel,
    listeners: new Set(),
    statusListeners: new Set(),
    connected: false,
    teardown: null,
    removed: false,
  };
  channel.on("broadcast", { event: "*" }, (msg) => {
    for (const l of e.listeners) l(msg.event, msg.payload);
  });
  void supabase.realtime.setAuth().then(() => {
    if (e.removed) return;
    channel.subscribe((status) => {
      if (e.removed) return;
      e.connected = status === "SUBSCRIBED";
      for (const s of e.statusListeners) s(e.connected);
    });
  });
  return e;
}

export function subscribeOrgChannel(
  orgId: string,
  kind: "vehicles" | "status",
  onEvent: Listener,
  onStatus?: StatusListener,
): () => void {
  const topic = `org:${orgId}:${kind}`;
  let entry = entries.get(topic);
  if (!entry) {
    entry = open(topic);
    entries.set(topic, entry);
  }
  const e = entry;
  if (e.teardown) {
    clearTimeout(e.teardown);
    e.teardown = null;
  }
  e.listeners.add(onEvent);
  if (onStatus) {
    e.statusListeners.add(onStatus);
    onStatus(e.connected);
  }
  return () => {
    e.listeners.delete(onEvent);
    if (onStatus) e.statusListeners.delete(onStatus);
    if (e.listeners.size || e.statusListeners.size || e.teardown) return;
    e.teardown = setTimeout(() => {
      if (e.listeners.size || e.statusListeners.size) return;
      e.removed = true;
      entries.delete(topic);
      void browserClient().removeChannel(e.channel);
    }, LINGER_MS);
  };
}
