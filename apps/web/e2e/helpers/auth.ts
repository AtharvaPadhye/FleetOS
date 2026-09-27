import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface MailpitSearch {
  messages: { ID: string }[];
}

/** Read the newest magic link sent to `email` from the local inbox (Mailpit). */
export async function magicLinkFor(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const found = (await res.json()) as MailpitSearch;
    const id = found.messages[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string; HTML: string };
      const link = `${msg.Text}\n${msg.HTML}`.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/)?.[0];
      if (link) return link.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No magic link arrived for ${email} within ${timeoutMs} ms`);
}

export const uniqueEmail = (tag: string) =>
  `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@fleetos.test`;

/** Real sign-in: request a link on /sign-in, then follow it from the inbox. */
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await magicLinkFor(email));
}

export async function createOrg(page: Page, name: string, city?: string) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Organization name").fill(name);
  if (city) await page.getByLabel(/Main city/).fill(city);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL("/");
}
