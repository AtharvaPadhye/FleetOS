import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMail } from "@/lib/mail";

/**
 * Drain the notification outbox (task 5.11): emails through the mailer, Slack through the org's incoming
 * webhook. Each delivery is retried on later ticks up to 5 times, then marked failed.
 */
export async function deliverNotifications(db: SupabaseClient, limit = 50): Promise<{ sent: number; failed: number }> {
  const { data, error } = await db.rpc("engine_claim_deliveries", { p_limit: limit });
  if (error) throw new Error(error.message);
  let sent = 0;
  let failed = 0;
  for (const d of (data ?? []) as {
    id: number;
    channel: "email" | "slack";
    recipient: string;
    subject: string;
    body: string;
  }[]) {
    let problem: string | null = null;
    try {
      if (d.channel === "email") await sendMail({ to: d.recipient, subject: d.subject, text: d.body });
      else {
        const res = await fetch(d.recipient, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `*${d.subject}*\n${d.body}` }),
        });
        if (!res.ok) problem = `Slack answered ${res.status}`;
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    const { error: rErr } = await db.rpc("engine_delivery_result", {
      p_id: d.id,
      p_ok: problem === null,
      p_error: problem,
    });
    if (rErr) throw new Error(rErr.message);
    if (problem === null) sent++;
    else failed++;
  }
  return { sent, failed };
}
