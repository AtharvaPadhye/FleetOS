import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser } from "@playwright/test";
import { signIn, uniqueEmail } from "./auth";

/** Service-role client and Bearer tokens for API tests (local Supabase only). */
export const admin = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });

export async function userToken(tag: string): Promise<{ id: string; email: string; token: string }> {
  const db = admin();
  const email = uniqueEmail(tag);
  const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const { data: link } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties!.hashed_token });
  return { id: created.user.id, email, token: data.session!.access_token };
}

/**
 * A signed-in browser session for `email` (created if needed), for specs that build their own fixture org.
 * Magic links are rate-limited per email, so sign in once per spec and reuse the cookies.
 */
export async function sessionCookies(browser: Browser, email: string) {
  const db = admin();
  await db.auth.admin.createUser({ email, email_confirm: true }).catch(() => undefined);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email);
  const { cookies } = await ctx.storageState();
  await ctx.close();
  return cookies;
}

export async function userId(email: string): Promise<string> {
  const { data, error } = await admin().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const u = data.users.find((x) => x.email === email);
  if (!u) throw new Error(`No user ${email}`);
  return u.id;
}
