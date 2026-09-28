"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { generateReport, revokeShare, shareReport } from "@/lib/services/reports";
import type { SettingsState } from "./settings";

async function money() {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) throw new ApiProblem("unauthenticated", "Sign in again.");
  if (!["owner", "admin", "finance"].includes(activeOrg.role))
    throw new ApiProblem("forbidden", "Reports are for owners, admins and finance.");
  return { org: activeOrg, db: await createClient() };
}
const message = (e: unknown) => (e instanceof ApiProblem ? e.message : "Something went wrong. Try again.");

/** RP-1: generate a snapshot for a month (a new version if one exists). */
export async function generateReportAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  let id: string;
  try {
    const { org, db } = await money();
    id = (await generateReport(db, org, String(form.get("month") ?? ""))).id;
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/reports");
  redirect(`/reports/${id}`);
}

/** RP-4: share with a recipient; returns the link to copy. */
export async function shareReportAction(
  reportId: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  try {
    const { org, db } = await money();
    const recipient = String(form.get("recipient") ?? "").trim();
    const days = Number(form.get("days") || 30);
    if (!recipient) return { status: "error", message: "Say who it's for, e.g. the lender's name." };
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    const share = await shareReport(db, org, reportId, { recipient, days, origin });
    revalidatePath(`/reports/${reportId}`);
    return { status: "ok", message: `Link for ${recipient} created`, link: share.url };
  } catch (e) {
    return { status: "error", message: message(e) };
  }
}

export async function revokeShareAction(
  reportId: string,
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  try {
    const { org, db } = await money();
    await revokeShare(db, org, reportId, String(form.get("id")));
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath(`/reports/${reportId}`);
  return { status: "ok", message: "Revoked" };
}
