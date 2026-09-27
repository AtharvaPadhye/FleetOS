"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

const Email = z.email({ error: "Enter a valid email address." });

/** Only allow same-site relative paths as the post-sign-in destination (no open redirects). */
function safeNext(value: FormDataEntryValue | null): string {
  const v = typeof value === "string" ? value : "";
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

export async function signInWithEmail(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = Email.safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Enter a valid email." };

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const next = safeNext(form.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true },
  });
  if (error) return { status: "error", message: `We couldn't send the sign-in link: ${error.message}` };
  return { status: "sent", email: parsed.data };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
