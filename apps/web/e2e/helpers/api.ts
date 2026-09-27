import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { uniqueEmail } from "./auth";

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
