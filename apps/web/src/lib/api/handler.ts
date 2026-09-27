import "server-only";
import { randomUUID } from "node:crypto";
import { createClient as createBearerClient, type SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { publicEnv } from "@/lib/env";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import type { ErrorCode } from "./schemas";
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

export class ApiProblem extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>[],
  ) {
    super(message);
  }
}

export type DataSource = "live" | "simulated" | "csv" | "inferred" | "static" | "manual" | "mixed";

export interface OrgContext {
  id: string;
  role: z.infer<typeof import("./schemas").Role>;
  timezone: string;
  isDemo: boolean;
}

export interface ApiContext<Q> {
  request: Request;
  requestId: string;
  db: SupabaseClient;
  user: { id: string; email: string };
  /** Present when the operation needs an org (the default). */
  org: OrgContext;
  query: Q;
  params: Record<string, string>;
}

export interface ApiResult<R> {
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

export function apiRoute<Q extends z.ZodType, R extends z.ZodType>(
  op: Operation<Q, R>,
  handler: (ctx: ApiContext<z.infer<Q>>) => Promise<ApiResult<z.infer<R>>>,
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

      const result = await handler({
        request,
        requestId,
        db: auth.db,
        user: auth.user,
        org: org as OrgContext,
        query: parsedQuery.data,
        params: (await route?.params) ?? {},
      });
      const body = op.response.safeParse(result.body);
      if (!body.success) {
        console.error(`[api] ${op.operationId} response failed its schema`, requestId, body.error.issues.slice(0, 5));
        return problem("internal", "The server built an invalid response. It's been logged.", requestId, headers);
      }
      if (result.dataSource) headers.set("X-FleetOS-Data-Source", result.dataSource);
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(body.data), { status: result.status ?? 200, headers });
    } catch (e) {
      if (e instanceof ApiProblem) return problem(e.code, e.message, requestId, headers, e.details);
      console.error(`[api] ${op.operationId} failed`, requestId, e);
      return problem("internal", "Something went wrong on our side. Try again.", requestId, headers);
    }
  };
}
