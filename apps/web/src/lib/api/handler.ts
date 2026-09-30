import "server-only";
import { randomUUID } from "node:crypto";
import { createClient as createBearerClient, type SupabaseClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { capabilityStatuses } from "@fleetos/domain";
import type { z } from "zod";
import { publicEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import type { ErrorCode } from "./schemas";
import { ApiProblem } from "./problem";

export { ApiProblem };
import type { Operation } from "./operations";

/**
 * Wraps a /api/v1 route handler (docs/architecture/api.md §1): request id, auth (session cookie or
 * `Authorization: Bearer <user JWT>`), active org from `X-FleetOS-Org` checked against memberships (foreign
 * org → 404), query validation, response validation against the operation's zod schema, standard headers
 * and error bodies. Every query runs as the user, so row-level security still applies.
 */

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  rate_limited: 429,
  capability_unavailable: 501,
  upstream_unavailable: 503,
  internal: 500,
};

export type DataSource = "live" | "simulated" | "csv" | "inferred" | "static" | "manual" | "mixed";

export interface OrgContext {
  id: string;
  role: z.infer<typeof import("./schemas").Role>;
  timezone: string;
  isDemo: boolean;
}

const CAPABILITY_DOCS = "https://github.com/AtharvaPadhye/FleetOS/blob/main/docs/requirements/data-sources.md";

export interface ApiContext<Q, B = unknown> {
  request: Request;
  requestId: string;
  db: SupabaseClient;
  user: { id: string; email: string };
  /** Present when the operation needs an org (the default). */
  org: OrgContext;
  query: Q;
  /** Parsed JSON body, for operations that declare one. */
  body: B;
  params: Record<string, string>;
}

export interface ApiResult<R> {
  /** A non-JSON response (e.g. a CSV download), sent as-is with the standard headers added. */
  raw?: Response;
  body: R;
  dataSource?: DataSource;
  status?: number;
}

function problem(code: ErrorCode, message: string, requestId: string, headers: Headers, details?: unknown[]) {
  headers.set("Content-Type", "application/json");
  return new Response(
    JSON.stringify({ error: code, message, ...(details ? { details } : {}), request_id: requestId }),
    {
      status: STATUS[code],
      headers,
    },
  );
}

async function authenticate(request: Request) {
  const auth = request.headers.get("authorization");
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  const db = token
    ? createBearerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createCookieClient();
  // Verifies the JWT (signature + expiry) rather than trusting it.
  const { data } = await db.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (!sub) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  return { db, user: { id: sub, email } };
}

/** Query string → plain object; repeated keys (and comma lists) become arrays for array schemas. */
function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key).flatMap((v) => v.split(","));
    out[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return out;
}

export function apiRoute<Q extends z.ZodType, R extends z.ZodType, B extends z.ZodType = z.ZodUnknown>(
  op: Operation<Q, R, B>,
  handler: (ctx: ApiContext<z.infer<Q>, z.infer<B>>) => Promise<ApiResult<z.infer<R>>>,
) {
  return async (request: Request, route?: { params?: Promise<Record<string, string>> }) => {
    const requestId = request.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    const headers = new Headers({
      "X-Request-Id": requestId,
      "X-FleetOS-Stability": op.stability,
      "Cache-Control": "no-store",
    });
    try {
      const auth = await authenticate(request);
      if (!auth) return problem("unauthenticated", "Sign in, or send a valid Bearer token.", requestId, headers);

      const parsedQuery = op.query.safeParse(queryObject(new URL(request.url)));
      if (!parsedQuery.success)
        return problem(
          "invalid_request",
          "Check the query parameters.",
          requestId,
          headers,
          parsedQuery.error.issues.flatMap((i) =>
            i.code === "unrecognized_keys"
              ? i.keys.map((k) => ({ param: k, message: "Unknown or not yet supported parameter." }))
              : [{ param: i.path.join("."), message: i.message }],
          ),
        );

      let org: OrgContext | undefined;
      const orgId = request.headers.get("x-fleetos-org");
      if (op.org !== "none") {
        if (!orgId && op.org === "required")
          return problem("invalid_request", "Send the active org id in the X-FleetOS-Org header.", requestId, headers);
        if (orgId) {
          const { data: m } = await auth.db
            .from("memberships")
            .select("role, orgs(id, timezone, is_demo)")
            .eq("user_id", auth.user.id)
            .eq("org_id", orgId)
            .maybeSingle<{
              role: OrgContext["role"];
              orgs: { id: string; timezone: string; is_demo: boolean } | null;
            }>();
          // Unknown and foreign orgs look the same (NFR TEN-2).
          if (!m?.orgs) return problem("not_found", "No such organization.", requestId, headers);
          org = { id: m.orgs.id, role: m.role, timezone: m.orgs.timezone, isDemo: m.orgs.is_demo };
        }
      }
      if (op.roles && org && !op.roles.includes(org.role))
        return problem("forbidden", `This needs one of these roles: ${op.roles.join(", ")}.`, requestId, headers);

      // Preview operations (ADR-0006): without the data source, 501 — never an empty 200.
      if (op.capability && org) {
        const cap = capabilityStatuses({ isDemo: org.isDemo }).find((c) => c.name === op.capability);
        if (!cap || cap.state === "unavailable") {
          headers.set("Content-Type", "application/json");
          return new Response(
            JSON.stringify({
              error: "capability_unavailable",
              capability: op.capability,
              message: `This organization has no ${op.capability.replaceAll("_", " ")} source connected yet${cap?.fallback ? ` (fallback: ${cap.fallback})` : ""}.`,
              docs: CAPABILITY_DOCS,
              request_id: requestId,
            }),
            { status: 501, headers },
          );
        }
      }

      let requestBody: unknown = undefined;
      if (op.body) {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return problem("invalid_request", "Send a JSON body.", requestId, headers);
        }
        const parsed = op.body.safeParse(raw);
        if (!parsed.success)
          return problem(
            "validation_failed",
            "Check the request body.",
            requestId,
            headers,
            parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
          );
        requestBody = parsed.data;
      }

      const result = await handler({
        request,
        requestId,
        db: auth.db,
        user: auth.user,
        org: org as OrgContext,
        query: parsedQuery.data,
        body: requestBody as z.infer<B>,
        params: (await route?.params) ?? {},
      });
      if (result.raw) {
        for (const [k, v] of headers) if (!result.raw.headers.has(k)) result.raw.headers.set(k, v);
        if (result.dataSource) result.raw.headers.set("X-FleetOS-Data-Source", result.dataSource);
        return result.raw;
      }
      const body = op.response.safeParse(result.body);
      if (!body.success) {
        log.error("api.response_invalid", {
          request_id: requestId,
          operation: op.operationId,
          org_id: org?.id,
          issues: body.error.issues.slice(0, 5),
        });
        Sentry.captureMessage(`${op.operationId} response failed its schema`, {
          level: "error",
          tags: { request_id: requestId, org_id: org?.id, operation: op.operationId },
        });
        return problem("internal", "The server built an invalid response. It's been logged.", requestId, headers);
      }
      const dataSource = result.dataSource ?? (op.capability ? "simulated" : undefined);
      if (dataSource) headers.set("X-FleetOS-Data-Source", dataSource);
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(body.data), { status: result.status ?? 200, headers });
    } catch (e) {
      if (e instanceof ApiProblem) return problem(e.code, e.message, requestId, headers, e.details);
      // The org the request asked for (may be unverified if the failure came before the membership check).
      const orgId = request.headers.get("x-fleetos-org") ?? undefined;
      log.error("api.failed", { request_id: requestId, operation: op.operationId, org_id: orgId, err: e });
      Sentry.captureException(e, { tags: { request_id: requestId, operation: op.operationId, org_id: orgId } });
      return problem("internal", "Something went wrong on our side. Try again.", requestId, headers);
    }
  };
}
