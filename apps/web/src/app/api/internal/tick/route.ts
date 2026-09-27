import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server-env";
import { tickAll } from "@/lib/engine/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** Per-minute engine tick, called by pg_cron via pg_net (ADR-0014). Bearer-protected; not a public API. */
export async function POST(request: Request) {
  if (!authorized(request.headers.get("authorization"), serverEnv().TICK_SECRET)) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const results = await tickAll(createAdminClient());
  return Response.json(
    { ok: true, at: new Date().toISOString(), orgs: results },
    { headers: { "Cache-Control": "no-store" } },
  );
}
