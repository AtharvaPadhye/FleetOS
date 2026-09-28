"use server";

import { revalidatePath } from "next/cache";
import { ApiProblem } from "@/lib/api/problem";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  listNotifications,
  markRead,
  saveNotificationSettings,
  sendTestNotification,
  setSlackWebhook,
  type NotificationOut,
} from "@/lib/services/notifications";
import type { SettingsState } from "./settings";
import { SEVERITIES } from "@fleetos/domain";

async function me() {
  const { user, activeOrg } = await getAppContext();
  if (!user || !activeOrg) throw new ApiProblem("unauthenticated", "Sign in again.");
  return { user, org: activeOrg, db: await createClient() };
}
const message = (e: unknown) => (e instanceof ApiProblem ? e.message : "Couldn't save that. Try again.");

/** The bell's panel: newest first (GL-5). */
export async function recentNotifications(): Promise<NotificationOut[]> {
  const { user, org, db } = await me();
  return (await listNotifications(db, org, user.id, { limit: 20, offset: 0 })).items;
}

export async function markAllRead(): Promise<void> {
  const { user, org, db } = await me();
  await markRead(db, org, user.id, { all: true });
  revalidatePath("/", "layout");
}

export async function markOneRead(id: string): Promise<void> {
  const { user, org, db } = await me();
  await markRead(db, org, user.id, { ids: [id] });
}

/** ST-6: the severity × channel matrix. */
export async function saveNotificationPrefs(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  try {
    const { user, org, db } = await me();
    const input = Object.fromEntries(
      SEVERITIES.map((s) => [
        s,
        {
          in_app: form.get(`${s}_in_app`) === "on",
          email: form.get(`${s}_email`) === "on",
          ...(form.get("manage_slack") === "1" ? { slack: form.get(`${s}_slack`) === "on" } : {}),
        },
      ]),
    );
    await saveNotificationSettings(db, org, user.id, input);
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/settings/notifications");
  return { status: "ok", message: "Saved" };
}

export async function saveSlackWebhook(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  try {
    const { org, db } = await me();
    const url = String(form.get("webhook") ?? "").trim();
    // Disconnecting is explicit; an empty field never silently removes the channel.
    if (form.get("disconnect") === "on") await setSlackWebhook(db, org, null);
    else if (!url) return { status: "error", message: "Paste the Slack incoming webhook URL." };
    else await setSlackWebhook(db, org, url);
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  revalidatePath("/settings/notifications");
  return { status: "ok", message: "Slack settings saved" };
}

export async function sendTest(): Promise<SettingsState> {
  try {
    const { org, db } = await me();
    await sendTestNotification(db, org);
  } catch (e) {
    return { status: "error", message: message(e) };
  }
  return { status: "ok", message: "Test sent: check the bell, and Slack within a minute if it's connected" };
}
