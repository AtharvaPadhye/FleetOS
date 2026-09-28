"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ExceptionRuleDef, RuleCondition, TicketType } from "@fleetos/domain";
import { ExceptionRuleWrite } from "@/lib/api/schemas";
import { ApiProblem } from "@/lib/api/problem";
import { ACTIVE_ORG_COOKIE, getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createRule, updateRule } from "@/lib/services/exceptions";
import {
  invite,
  previewRule,
  removeMember,
  revokeInvitation,
  savePolicies,
  saveSlaPolicies,
  setMemberRole,
  updateOrg,
} from "@/lib/services/settings";

export type SettingsState =
  { status: "idle" } | { status: "error"; message: string } | { status: "ok"; message: string; link?: string };

const message = (e: unknown) => (e instanceof ApiProblem ? e.message : "Couldn't save that. Try again.");
async function admin() {
  const { user, activeOrg } = await getAppContext();
  if (!user || !activeOrg) throw new ApiProblem("unauthenticated", "Sign in again.");
  if (!["owner", "admin"].includes(activeOrg.role))
    throw new ApiProblem("forbidden", "Only owners and admins can change settings.");
  return { user, org: activeOrg, db: await createClient() };
}
const pct = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? undefined : Number(s) / 100;
};

/** ST-1: organization details and targets. */
export async function saveOrgSettings(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  try {
    const { org, db } = await admin();
    const reserve = String(form.get("reserve") ?? "").replace(/[$,\s]/g, "");
    const values = {
      name: String(form.get("name") ?? "").trim(),
      timezone: String(form.get("timezone") ?? "").trim(),
      availability_target: pct(form.get("availability_target")),
      service_start: String(form.get("service_start") ?? "") || undefined,
      service_end: String(form.get("service_end") ?? "") || undefined,
      maintenance_reserve_monthly_cents: reserve === "" ? undefined : Math.round(Number(reserve) * 100),
    };
    if (
      values.availability_target !== undefined &&
      !(values.availability_target > 0 && values.availability_target <= 1)
    )
      return { status: "error", message: "The availability target is a percentage from 1 to 100." };
    if (values.maintenance_reserve_monthly_cents !== undefined && !(values.maintenance_reserve_monthly_cents >= 0))
      return { status: "error", message: "Enter the reserve in dollars per car per month." };
    await updateOrg(db, org, values);
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/", "layout");
  return { status: "ok", message: "Saved" };
}

/** ST-2: fleet policies. */
export async function savePolicyForm(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  try {
    const { org, db } = await admin();
    await savePolicies(db, org, [
      { key: "MIN-SOC", enabled: true, config: { soc: pct(form.get("min_soc")) } },
      { key: "CHG-TARGET", enabled: true, config: { soc: pct(form.get("charge_target")) } },
      { key: "CLN-02", enabled: form.get("cln02") === "on" },
      {
        key: "AUTO-DISPATCH",
        enabled: form.get("auto_dispatch") === "on",
        config: { after_min: Number(form.get("after_min") || 5) },
      },
    ]);
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/", "layout");
  return { status: "ok", message: "Policies saved" };
}

export async function saveSlaForm(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  try {
    const { org, db } = await admin();
    const types = ["cleaning", "maintenance", "roadside", "charging", "other"] as TicketType[];
    const rows = types.map((t) => ({
      ticket_type: t,
      response_min: Number(form.get(`${t}_response`)),
      resolution_min: Number(form.get(`${t}_resolution`)),
    }));
    for (const r of rows)
      if (
        !Number.isInteger(r.response_min) ||
        !Number.isInteger(r.resolution_min) ||
        r.response_min < 1 ||
        r.resolution_min < 1
      )
        return { status: "error", message: "SLA targets are whole minutes, at least 1." };
    await saveSlaPolicies(db, org, rows);
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/settings", "layout");
  return { status: "ok", message: "SLA targets saved; new tickets use them" };
}

// ST-3 members.
export async function inviteMember(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  try {
    const { org, db } = await admin();
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role") ?? "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: "error", message: "Enter an email address." };
    if (!["admin", "ops", "finance", "viewer"].includes(role)) return { status: "error", message: "Pick a role." };
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    const r = await invite(db, org, { email, role: role as "admin", orgName: org.name, origin });
    revalidatePath("/settings/members");
    return {
      status: "ok",
      message: r.emailed ? `Invitation sent to ${r.email}` : `Couldn't email ${r.email}; share this link instead`,
      link: r.link,
    };
  } catch (e) {
    return { status: "error", message: message(e) };
  }
}

export async function memberAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  try {
    const { org, db } = await admin();
    const kind = String(form.get("kind"));
    const id = String(form.get("id"));
    const role = String(form.get("role"));
    if (kind === "role" && !["owner", "admin", "ops", "finance", "viewer"].includes(role))
      return { status: "error", message: "Pick a role." };
    if (kind === "role") await setMemberRole(db, org, id, role as "admin");
    else if (kind === "remove") await removeMember(db, org, id);
    else if (kind === "revoke") await revokeInvitation(db, org, id);
    else return { status: "error", message: "Unknown action." };
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/settings/members");
  return { status: "ok", message: "Saved" };
}

// EX-5 rules editor.
function ruleFromForm(form: FormData) {
  const field = String(form.get("field"));
  const op = String(form.get("op"));
  const raw = String(form.get("value") ?? "").trim();
  const value = field === "alert" ? raw : field === "inside_hub" || field === "charging" ? raw === "true" : Number(raw);
  const forMin = Number(form.get("for_min") || 0);
  // System rules with several tests keep their shipped condition (the form has no field then).
  const condition: RuleCondition | undefined =
    form.get("field") === null
      ? undefined
      : { all: [{ field: field as never, op: op as never, value }], ...(forMin ? { for_min: forMin } : {}) };
  return ExceptionRuleWrite.safeParse({
    ...(form.get("key") ? { key: String(form.get("key")) } : {}),
    name: String(form.get("name") ?? "").trim(),
    ...(condition ? { condition } : {}),
    class: String(form.get("class")),
    severity: String(form.get("severity")),
    blocks_service: form.get("blocks_service") === "on",
    recommended_action: { label: String(form.get("action_label") ?? "").trim() || "Investigate" },
    enabled: form.get("enabled") !== "off",
  });
}

export async function saveRule(id: string | null, _prev: SettingsState, form: FormData): Promise<SettingsState> {
  const parsed = ruleFromForm(form);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the rule." };
  try {
    const { org, db } = await admin();
    if (id) {
      const { key: _key, ...rest } = parsed.data;
      void _key;
      await updateRule(db, org.id, id, rest);
    } else await createRule(db, org.id, parsed.data);
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/settings/rules");
  return { status: "ok", message: id ? "Rule saved" : "Rule added" };
}

export async function toggleRule(id: string, enabled: boolean): Promise<SettingsState> {
  try {
    const { org, db } = await admin();
    await updateRule(db, org.id, id, { enabled });
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/settings/rules");
  return { status: "ok", message: enabled ? "Enabled" : "Disabled" };
}

/** "Test against the last 24 h" for the rule as currently typed in the form. */
export async function testRule(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const parsed = ruleFromForm(form);
  if (!parsed.success || !parsed.data.condition)
    return {
      status: "error",
      message: parsed.success ? "Add a condition." : (parsed.error.issues[0]?.message ?? "Check the rule."),
    };
  try {
    const { org, db } = await admin();
    const rule: ExceptionRuleDef = {
      key: parsed.data.key ?? "preview",
      name: parsed.data.name ?? "Preview",
      condition: parsed.data.condition as RuleCondition,
      class: parsed.data.class ?? "other",
      severity: parsed.data.severity ?? "low",
      blocks_service: false,
      recommended_action: { label: "" },
      auto_actions: {},
      auto_resolve: true,
    };
    const r = await previewRule(db, org, rule);
    return {
      status: "ok",
      message:
        r.opened === 0
          ? "Would not have opened any exceptions in the last 24 hours."
          : `Would have opened ${r.opened} ${r.opened === 1 ? "exception" : "exceptions"} on ${r.vehicles} ${r.vehicles === 1 ? "car" : "cars"} in the last 24 hours (10-minute resolution).`,
    };
  } catch (e) {
    return { status: "error", message: message(e) };
  }
}

/** Accept an invitation and switch to that org (ST-3). */
export async function acceptInvite(token: string): Promise<SettingsState> {
  const db = await createClient();
  const { data, error } = await db.rpc("accept_invitation", { p_token: token });
  if (error) return { status: "error", message: error.message };
  (await cookies()).set(ACTIVE_ORG_COOKIE, (data as { org_id: string }).org_id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}
