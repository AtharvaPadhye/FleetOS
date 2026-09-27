"use server";

import { revalidatePath } from "next/cache";
import {
  EXCEPTION_CLASSES,
  SEVERITIES,
  type ExceptionClass,
  type ExceptionStatus,
  type Severity,
} from "@fleetos/domain";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createException, updateException } from "@/lib/services/exceptions";

export type ExceptionActionState =
  { status: "idle" } | { status: "error"; message: string } | { status: "ok"; done: string };

const INTENTS = {
  assign_me: { done: "Assigned to you" },
  unassign: { done: "Unassigned" },
  start: { done: "Marked in progress", status: "in_progress" },
  resolve: { done: "Resolved", status: "resolved" },
  dismiss: { done: "Dismissed", status: "dismissed" },
  reopen: { done: "Reopened", status: "open" },
} as const satisfies Record<string, { done: string; status?: ExceptionStatus }>;

async function context() {
  const { user, activeOrg } = await getAppContext();
  if (!user || !activeOrg) throw new ApiProblem("unauthenticated", "Sign in again.");
  if (!["owner", "admin", "ops"].includes(activeOrg.role))
    throw new ApiProblem("forbidden", "Only owners, admins and ops can change exceptions.");
  return { user, org: activeOrg, db: await createClient() };
}

const message = (e: unknown) => (e instanceof ApiProblem ? e.message : "Couldn't save that. Try again.");

/** Assign, start, resolve, dismiss or reopen an exception, with an optional note (PRD EX-1 owner and status). */
export async function changeException(
  id: string,
  _prev: ExceptionActionState,
  form: FormData,
): Promise<ExceptionActionState> {
  const intent = String(form.get("intent")) as keyof typeof INTENTS;
  const spec = INTENTS[intent];
  if (!spec) return { status: "error", message: "Unknown action." };
  const note = String(form.get("note") ?? "").trim();
  if (note.length > 2000) return { status: "error", message: "Keep the note under 2,000 characters." };
  if (intent === "dismiss" && !note) return { status: "error", message: "Say why you're dismissing it." };
  try {
    const { user, org, db } = await context();
    await updateException(db, org, id, {
      ...("status" in spec ? { status: spec.status } : {}),
      ...(intent === "assign_me" ? { owner_user_id: user.id } : intent === "unassign" ? { owner_user_id: null } : {}),
      note: note || undefined,
    });
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/exceptions", "layout");
  return { status: "ok", done: spec.done };
}

export type ReportState =
  | { status: "idle" }
  | { status: "error"; message: string; values: Record<string, string> }
  | { status: "ok"; id: string };

/** Report an exception by hand (PRD EX-2). */
export async function reportException(_prev: ReportState, form: FormData): Promise<ReportState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const fail = (m: string): ReportState => ({ status: "error", message: m, values });
  const title = (values.title ?? "").trim();
  const cls = values.class as ExceptionClass;
  const severity = values.severity as Severity;
  if (!title) return fail("Describe the problem in a few words.");
  if (title.length > 120) return fail("Keep the summary under 120 characters.");
  if (!EXCEPTION_CLASSES.includes(cls)) return fail("Pick what kind of problem it is.");
  if (!SEVERITIES.includes(severity)) return fail("Pick a severity.");
  try {
    const { org, db } = await context();
    let vehicleId: string | undefined;
    if (values.vehicle) {
      const { data } = await db
        .from("vehicles")
        .select("id")
        .eq("org_id", org.id)
        .eq("number", values.vehicle)
        .maybeSingle();
      if (!data) return fail(`No vehicle ${values.vehicle} in this fleet.`);
      vehicleId = data.id as string;
    }
    const type =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 60) || "manual_report";
    const id = await createException(db, org, {
      vehicle_id: vehicleId,
      type,
      title,
      class: cls,
      severity,
      description: (values.description ?? "").trim() || undefined,
      blocks_service: values.blocks_service === "on",
    });
    revalidatePath("/exceptions", "layout");
    return { status: "ok", id };
  } catch (e) {
    return fail(message(e));
  }
}
