import { z } from "zod";
import { CAPABILITIES, CAPABILITY_STATES, VEHICLE_STATUSES } from "@fleetos/domain";

/**
 * Response and request schemas for /api/v1 (task 3.8). Each mirrors a schema in
 * docs/architecture/openapi.yaml; `src/lib/api/contract.test.ts` fails CI if they drift apart.
 * Handlers validate every response with these before sending it.
 */

export const ROLES = ["owner", "admin", "ops", "finance", "viewer"] as const;
export const Role = z.enum(ROLES);

export const ERROR_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "validation_failed",
  "rate_limited",
  "capability_unavailable",
  "upstream_unavailable",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ApiError = z.object({
  error: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.array(z.object({}).loose()).optional(),
  request_id: z.string(),
});

export const Org = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  currency: z.string(),
  region: z.enum(["na", "eu", "cn"]),
  is_demo: z.boolean(),
  availability_target: z.number(),
  low_soc_threshold: z.number(),
  service_start: z.string(),
  service_end: z.string(),
});
export type Org = z.infer<typeof Org>;

export const Me = z.object({
  user_id: z.uuid(),
  email: z.email(),
  full_name: z.string().nullable(),
  active_org_id: z.uuid().optional(),
  memberships: z.array(z.object({ org: Org, role: Role })),
});

export const OrgList = z.array(Org);

export const Capabilities = z.object({
  org_id: z.uuid(),
  capabilities: z.array(
    z.object({
      name: z.enum(CAPABILITIES),
      state: z.enum(CAPABILITY_STATES),
      source: z.string().nullable(),
      fallback: z.string().nullable(),
    }),
  ),
});

export const PageInfo = z.object({
  next_cursor: z.string().nullable(),
  total: z.number().int(),
  total_is_estimate: z.boolean(),
});

export const VehicleStatus = z.enum(VEHICLE_STATUSES);
