import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { tickAll, tickOrg } from "@/lib/engine/tick";
import { allocateFixedCosts } from "@/lib/engine/costs";
import { deliverNotifications } from "@/lib/engine/deliveries";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Per-minute engine tick, called by pg_cron via pg_net (ADR-0014). Bearer-protected; not a public API.
 * `?org=<id>` ticks just that org (tests and debugging); orgs are ticked one after another, so a large number
 * of orgs needs the Phase 4 worker.
 */
export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"), serverEnv().TICK_SECRET)) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const db = createAdminClient();
  const org = new URL(request.url).searchParams.get("org");
  if (org && !UUID.test(org)) return Response.json({ error: "invalid_request" }, { status: 400 });
  const results = org ? [await tickOrg(db, org)] : await tickAll(db);
  const allocationLines = await allocateFixedCosts(db, new Date(), org ?? undefined);
  // Email and Slack notifications queued by this tick's events (and any retries).
  const notifications = await deliverNotifications(db);
  // One summary line per tick (NFR OBS-2); failures throw and reach Sentry via instrumentation.ts.
  log.info("tick.done", {
    request_id: request.headers.get("x-request-id") ?? undefined,
    org_id: org ?? undefined,
    orgs: results.length,
    allocationLines,
    notifications,
  });
  return Response.json(
    { ok: true, at: new Date().toISOString(), orgs: results, allocationLines, notifications },
    { headers: { "Cache-Control": "no-store" } },
  );
}
