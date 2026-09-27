"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/** One browser client per tab; it acts as the signed-in user (session cookie), so RLS and channel policies apply. */
let client: SupabaseClient | null = null;
export function browserClient(): SupabaseClient {
  client ??= createBrowserClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return client;
}
