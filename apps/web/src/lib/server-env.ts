import "server-only";
import { z } from "zod";

/** Server-only secrets. Never prefixed NEXT_PUBLIC_, never sent to the browser (NFR SEC-3/SEC-4). */
const ServerEnv = z.object({
  SUPABASE_SECRET_KEY: z.string().min(20),
  TICK_SECRET: z.string().min(16),
});

export function serverEnv() {
  return ServerEnv.parse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    TICK_SECRET: process.env.TICK_SECRET,
  });
}
