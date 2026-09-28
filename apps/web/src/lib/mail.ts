import "server-only";

/**
 * Outgoing email (invitations now; notifications in task 5.11). Locally and in CI, messages go to Mailpit's
 * API so they can be read at MAILPIT_URL; a hosted deployment sets RESEND_API_KEY (task 2.6). Without either,
 * sending fails and callers show the link to copy instead.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
const FROM = { Email: process.env.MAIL_FROM ?? "noreply@fleetos.local", Name: "FleetOS" };

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.MAILPIT_URL);
}

export async function sendMail(m: Mail): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${FROM.Name} <${FROM.Email}>`,
        to: [m.to],
        subject: m.subject,
        text: m.text,
        html: m.html,
      }),
    });
    if (!res.ok) throw new Error(`Email wasn't sent (${res.status}).`);
    return;
  }
  if (process.env.MAILPIT_URL) {
    const res = await fetch(`${process.env.MAILPIT_URL.replace(/\/$/, "")}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ From: FROM, To: [{ Email: m.to }], Subject: m.subject, Text: m.text, HTML: m.html }),
    });
    if (!res.ok) throw new Error(`Email wasn't sent (${res.status}).`);
    return;
  }
  throw new Error("Email isn't configured on this deployment.");
}
