import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";

/**
 * Service-role client: bypasses RLS. Only for the engine tick and demo provisioning, which must set org_id
 * explicitly on every row (ADR-0004). Never import from client components.
 */
export function createAdminClient(): SupabaseClient {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
