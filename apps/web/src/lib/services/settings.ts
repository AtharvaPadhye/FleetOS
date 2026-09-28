import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TICKET_TYPES, type ExceptionRuleDef, type TicketType } from "@fleetos/domain";
import { emptyLive, evaluateRules, type ExceptionState, type VehicleLive } from "@fleetos/engine";
import { ApiProblem } from "@/lib/api/problem";
import type { OrgContext } from "@/lib/api/handler";
import { sendMail } from "@/lib/mail";
import type { ROLES } from "@/lib/api/schemas";

type AppRole = (typeof ROLES)[number];

/**
 * Settings (task 5.10, PRD ST-1..ST-3, ST-5, EX-5): the org, its people, fleet policies, SLA targets and the
 * exception-rule preview. Writes run as the user, so RLS and the audit triggers apply.
 */
type Org = Pick<OrgContext, "id" | "role" | "timezone">;
const ORG_COLUMNS =
  "id, name, slug, timezone, currency, region, is_demo, availability_target, low_soc_threshold, service_start, service_end, charge_target, auto_dispatch_after_min, maintenance_reserve_monthly_cents";

function writeError(error: { code?: string; message: string }, what: string): never {
  if (error.code === "42501") throw new ApiProblem("forbidden", `Only owners and admins can change ${what}.`);
  if (error.code === "23514" || error.code === "22023" || error.code === "22P02")
    throw new ApiProblem("validation_failed", error.message);
  if (error.code === "23505") throw new ApiProblem("conflict", error.message);
  if (error.code === "P0001") throw new ApiProblem("validation_failed", error.message);
  throw new ApiProblem("internal", error.message);
}

const hhmm = (t: string) => t.slice(0, 5);
export async function getOrg(db: SupabaseClient, org: Pick<Org, "id">) {
  const { data, error } = await db.from("orgs").select(ORG_COLUMNS).eq("id", org.id).single();
  if (error) throw new ApiProblem("internal", error.message);
  const o = data as Record<string, unknown>;
  return {
    id: o.id as string,
    name: o.name as string,
    slug: o.slug as string,
    timezone: o.timezone as string,
    currency: (o.currency as string).trim(),
    region: o.region as "na" | "eu" | "cn",
    is_demo: o.is_demo as boolean,
    availability_target: Number(o.availability_target),
    low_soc_threshold: Number(o.low_soc_threshold),
    service_start: hhmm(o.service_start as string),
    service_end: hhmm(o.service_end as string),
    charge_target: Number(o.charge_target),
    auto_dispatch_after_min: o.auto_dispatch_after_min === null ? null : Number(o.auto_dispatch_after_min),
    maintenance_reserve_monthly_cents: Number(o.maintenance_reserve_monthly_cents),
  };
}

export interface OrgInput {
  name?: string;
  timezone?: string;
  availability_target?: number;
  low_soc_threshold?: number;
  service_start?: string;
  service_end?: string;
  charge_target?: number;
  auto_dispatch_after_min?: number | null;
  maintenance_reserve_monthly_cents?: number;
}

/** ST-1: edit the org; audited by trigger. KPIs read these on every request, so they recompute at once. */
export async function updateOrg(db: SupabaseClient, org: Pick<Org, "id">, input: OrgInput) {
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
    } catch {
      throw new ApiProblem(
        "validation_failed",
        `"${input.timezone}" isn't a time zone. Use a name like America/Phoenix.`,
      );
    }
  }
  for (const k of ["service_start", "service_end"] as const) {
    const v = input[k];
    if (v !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(v))
      throw new ApiProblem("validation_failed", "Service hours use HH:MM, e.g. 06:00.");
  }
  if (input.service_start && input.service_end && input.service_start >= input.service_end)
    throw new ApiProblem("validation_failed", "The service window must end after it starts.");
  if (input.name !== undefined && !input.name.trim())
    throw new ApiProblem("validation_failed", "Enter the organization's name.");
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(patch).length) {
    const { data, error } = await db.from("orgs").update(patch).eq("id", org.id).select("id");
    if (error) writeError(error, "organization settings");
    if (!data?.length) throw new ApiProblem("forbidden", "Only owners and admins can change organization settings.");
  }
  return getOrg(db, org);
}

// ST-3: members and invitations.
export async function listMembers(db: SupabaseClient, org: Pick<Org, "id">) {
  const { data, error } = await db.rpc("org_members", { p_org: org.id });
  if (error) throw new ApiProblem("internal", error.message);
  return (
    (data ?? []) as { user_id: string; email: string; full_name: string | null; role: AppRole; joined_at: string }[]
  ).map((m) => ({
    ...m,
    joined_at: new Date(m.joined_at).toISOString(),
  }));
}

export async function setMemberRole(db: SupabaseClient, org: Pick<Org, "id">, userId: string, role: AppRole) {
  const { data, error } = await db
    .from("memberships")
    .update({ role })
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .select("user_id");
  if (error) writeError(error, "roles");
  if (!data?.length) throw new ApiProblem("not_found", "No such member, or you can't change their role.");
  const m = (await listMembers(db, org)).find((x) => x.user_id === userId);
  if (!m) throw new ApiProblem("not_found", "No such member.");
  return m;
}

export async function removeMember(db: SupabaseClient, org: Pick<Org, "id">, userId: string) {
  const { data, error } = await db
    .from("memberships")
    .delete()
    .eq("org_id", org.id)
    .eq("user_id", userId)
    .select("user_id");
  if (error) writeError(error, "members");
  if (!data?.length) throw new ApiProblem("not_found", "No such member, or you can't remove them.");
}

export async function listInvitations(db: SupabaseClient, org: Pick<Org, "id">) {
  const { data, error } = await db
    .from("invitations")
    .select("id, email, role, expires_at, created_at")
    .eq("org_id", org.id)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new ApiProblem("internal", error.message);
  return ((data ?? []) as { id: string; email: string; role: AppRole; expires_at: string }[]).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    expires_at: new Date(i.expires_at).toISOString(),
  }));
}

/**
 * Invite someone (ST-3): creates the invitation (replacing a pending one), emails the link, and returns it so
 * an admin can share it themselves when email isn't configured or doesn't arrive.
 */
export async function invite(
  db: SupabaseClient,
  org: Pick<Org, "id">,
  input: { email: string; role: AppRole; orgName: string; origin: string },
) {
  const { data, error } = await db.rpc("create_invitation", {
    p_org: org.id,
    p_email: input.email,
    p_role: input.role,
  });
  if (error) writeError(error, "members");
  const row = ((data ?? []) as { id: string; token: string; expires_at: string }[])[0]!;
  const link = `${input.origin}/invite/${row.token}`;
  let emailed = true;
  try {
    await sendMail({
      to: input.email.trim().toLowerCase(),
      subject: `You're invited to ${input.orgName} on FleetOS`,
      text: `You've been invited to join ${input.orgName} on FleetOS as ${input.role}.\n\nAccept the invitation: ${link}\n\nThe link works for 7 days.`,
      html: `<p>You've been invited to join <strong>${input.orgName.replace(/</g, "&lt;")}</strong> on FleetOS as ${input.role}.</p><p><a href="${link}">Accept the invitation</a></p><p>The link works for 7 days.</p>`,
    });
  } catch {
    emailed = false;
  }
  return {
    id: row.id,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    expires_at: new Date(row.expires_at).toISOString(),
    link,
    emailed,
  };
}

export async function revokeInvitation(db: SupabaseClient, org: Pick<Org, "id">, id: string) {
  const { data, error } = await db.from("invitations").delete().eq("org_id", org.id).eq("id", id).select("id");
  if (error) writeError(error, "invitations");
  if (!data?.length) throw new ApiProblem("not_found", "No such invitation.");
}

// ST-2: fleet policies. Each one is a view over the setting that actually drives behaviour.
export interface Policy {
  key: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  enabled: boolean;
  description: string;
}

export async function listPolicies(db: SupabaseClient, org: Pick<Org, "id">): Promise<Policy[]> {
  const [o, rule] = await Promise.all([
    getOrg(db, org),
    db
      .from("exception_rules")
      .select("enabled, blocks_service")
      .eq("org_id", org.id)
      .eq("key", "cabin_cleanliness")
      .maybeSingle(),
  ]);
  return [
    {
      key: "MIN-SOC",
      name: "Minimum battery to stay in service",
      kind: "min_soc",
      config: { soc: o.low_soc_threshold },
      enabled: true,
      description: "Cars below it head to charge; also the low-battery line on Fleet and Overview.",
    },
    {
      key: "CHG-TARGET",
      name: "Charge target",
      kind: "charge_target",
      config: { soc: o.charge_target },
      enabled: true,
      description: "How full cars charge; the hub forecast plans charger time with it.",
    },
    {
      key: "CLN-02",
      name: "Take a car out of service when its cabin needs cleaning",
      kind: "auto_remove",
      config: { rule: "cabin_cleanliness" },
      enabled: Boolean(rule.data?.enabled && rule.data?.blocks_service),
      description: "Uses the “Cabin needs cleaning” rule (cabin camera events).",
    },
    {
      key: "AUTO-DISPATCH",
      name: "Dispatch the recommended vendor automatically",
      kind: "auto_dispatch",
      config: { after_min: o.auto_dispatch_after_min ?? 5 },
      enabled: o.auto_dispatch_after_min !== null,
      description:
        "If nobody dispatches a blocking exception within this many minutes, FleetOS sends the top-ranked vendor.",
    },
  ];
}

/** PUT /policies: apply each policy to the setting behind it (owner/admin via RLS). */
export async function savePolicies(
  db: SupabaseClient,
  org: Pick<Org, "id">,
  policies: { key: string; enabled: boolean; config?: Record<string, unknown> }[],
) {
  const num = (v: unknown, lo: number, hi: number, what: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi)
      throw new ApiProblem("validation_failed", `${what} must be between ${lo} and ${hi}.`);
    return n;
  };
  const patch: OrgInput = {};
  for (const p of policies) {
    if (p.key === "MIN-SOC" && p.config?.soc !== undefined)
      patch.low_soc_threshold = num(p.config.soc, 0.05, 0.9, "Minimum battery");
    else if (p.key === "CHG-TARGET" && p.config?.soc !== undefined)
      patch.charge_target = num(p.config.soc, 0.5, 1, "Charge target");
    else if (p.key === "AUTO-DISPATCH")
      patch.auto_dispatch_after_min = p.enabled
        ? Math.round(num(p.config?.after_min ?? 5, 0, 1440, "Auto-dispatch delay"))
        : null;
    else if (p.key === "CLN-02") {
      const { data, error } = await db
        .from("exception_rules")
        .update({ blocks_service: p.enabled, enabled: true })
        .eq("org_id", org.id)
        .eq("key", "cabin_cleanliness")
        .select("id");
      if (error) writeError(error, "policies");
      if (!data?.length) throw new ApiProblem("forbidden", "Only owners and admins can change policies.");
    } else if (!["MIN-SOC", "CHG-TARGET"].includes(p.key))
      throw new ApiProblem("validation_failed", `Unknown policy ${p.key}.`);
  }
  if (
    patch.charge_target !== undefined &&
    patch.low_soc_threshold !== undefined &&
    patch.charge_target <= patch.low_soc_threshold
  )
    throw new ApiProblem("validation_failed", "The charge target must be above the minimum battery.");
  await updateOrg(db, org, patch);
  return listPolicies(db, org);
}

// Service: SLA targets per ticket type.
export async function listSlaPolicies(db: SupabaseClient, org: Pick<Org, "id">) {
  const { data, error } = await db
    .from("sla_policies")
    .select("ticket_type, response_min, resolution_min")
    .eq("org_id", org.id);
  if (error) throw new ApiProblem("internal", error.message);
  const byType = new Map(
    ((data ?? []) as { ticket_type: TicketType; response_min: number; resolution_min: number }[]).map((p) => [
      p.ticket_type,
      p,
    ]),
  );
  return TICKET_TYPES.flatMap((t) => (byType.get(t) ? [byType.get(t)!] : []));
}

export async function saveSlaPolicies(
  db: SupabaseClient,
  org: Pick<Org, "id">,
  input: { ticket_type: TicketType; response_min: number; resolution_min: number }[],
) {
  for (const p of input) {
    if (p.response_min > p.resolution_min)
      throw new ApiProblem(
        "validation_failed",
        `The ${p.ticket_type} response target can't be longer than its resolution target.`,
      );
    const { data, error } = await db
      .from("sla_policies")
      .update({ response_min: p.response_min, resolution_min: p.resolution_min })
      .eq("org_id", org.id)
      .eq("ticket_type", p.ticket_type)
      .select("id");
    if (error) writeError(error, "SLA targets");
    if (!data?.length) throw new ApiProblem("forbidden", "Only owners and admins can change SLA targets.");
  }
  return listSlaPolicies(db, org);
}

/**
 * EX-5 "test against the last 24 h": replay a rule over the fleet's telemetry (10-minute buckets) and alerts,
 * with the engine's own evaluator, and count how many exceptions it would have opened.
 */
export async function previewRule(db: SupabaseClient, org: Pick<Org, "id">, rule: ExceptionRuleDef, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const [samples, alerts] = await Promise.all([
    db.rpc("rule_preview_samples", { p_org: org.id, p_since: since.toISOString() }).limit(200_000),
    db
      .from("vehicle_alerts")
      .select("vehicle_id, name, started_at, ended_at")
      .eq("org_id", org.id)
      .or(`ended_at.is.null,ended_at.gte.${since.toISOString()}`)
      .lte("started_at", now.toISOString())
      .limit(20_000),
  ]);
  if (samples.error || alerts.error) throw new ApiProblem("internal", (samples.error ?? alerts.error)!.message);
  const byCar = new Map<string, Map<number, Record<string, number>>>();
  for (const s of (samples.data ?? []) as { vehicle_id: string; bucket: string; field: string; value: number }[]) {
    const t = Date.parse(s.bucket);
    const car = byCar.get(s.vehicle_id) ?? new Map<number, Record<string, number>>();
    car.set(t, { ...(car.get(t) ?? {}), [s.field]: Number(s.value) });
    byCar.set(s.vehicle_id, car);
  }
  const alertRows = (alerts.data ?? []) as {
    vehicle_id: string;
    name: string;
    started_at: string;
    ended_at: string | null;
  }[];
  for (const a of alertRows) if (!byCar.has(a.vehicle_id)) byCar.set(a.vehicle_id, new Map());
  let opened = 0;
  const cars = new Set<string>();
  const step = 10 * 60_000;
  for (const [vehicleId, buckets] of byCar) {
    const live: VehicleLive = { ...emptyLive(vehicleId), connectivity: "online", lastTelemetryAt: since };
    const state: ExceptionState = { rules: [rule], known: [] };
    const carAlerts = alertRows.filter((a) => a.vehicle_id === vehicleId);
    for (let t = Math.floor(since.getTime() / step) * step; t <= now.getTime(); t += step) {
      const f = buckets.get(t);
      if (f) {
        if (f.Soc !== undefined) live.soc = f.Soc / 100;
        if (f.VehicleSpeed !== undefined) live.speedMps = f.VehicleSpeed * 0.44704;
        const tyres = { fl: f.TpmsPressureFl, fr: f.TpmsPressureFr, rl: f.TpmsPressureRl, rr: f.TpmsPressureRr };
        if (Object.values(tyres).some((x) => x !== undefined))
          live.tpms = {
            fl: null,
            fr: null,
            rl: null,
            rr: null,
            ...live.tpms,
            ...Object.fromEntries(Object.entries(tyres).filter(([, v]) => v !== undefined)),
          };
        live.lastTelemetryAt = new Date(t);
      }
      live.activeAlerts = carAlerts
        .filter((a) => Date.parse(a.started_at) <= t && (!a.ended_at || Date.parse(a.ended_at) > t))
        .map((a) => a.name);
      const r = evaluateRules(state, live, new Date(t));
      if (r.opened.length) {
        opened += r.opened.length;
        cars.add(vehicleId);
      }
    }
  }
  return { opened, vehicles: cars.size, hours: 24, resolution_min: 10 };
}
