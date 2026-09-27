"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_ORG_COOKIE, getAppContext } from "@/lib/session";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

export type CreateOrgState = { status: "idle" } | { status: "error"; message: string };

const CreateOrg = z.object({
  name: z.string().trim().min(1, "Enter your organization's name.").max(120),
  city: z.string().trim().max(80).optional(),
  timezone: z.string().trim().min(1),
});

const cookieOptions = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 365 };

export async function createOrganization(_prev: CreateOrgState, form: FormData): Promise<CreateOrgState> {
  const parsed = CreateOrg.safeParse({
    name: form.get("name"),
    city: form.get("city") || undefined,
    timezone: form.get("timezone"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };

  const supabase = await createClient();
  const base = slugify(parsed.data.name);
  let orgId: string | null = null;
  for (let attempt = 0; attempt < 5 && !orgId; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase.rpc("create_org", {
      p_name: parsed.data.name,
      p_slug: slug,
      p_timezone: parsed.data.timezone,
      p_city: parsed.data.city ?? null,
    });
    if (!error) orgId = (data as { id: string }).id;
    else if (error.code !== "23505") return { status: "error", message: error.message };
  }
  if (!orgId)
    return { status: "error", message: "Couldn't create a unique address for this organization. Try another name." };

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, cookieOptions);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function switchOrganization(orgId: string) {
  const { orgs } = await getAppContext();
  if (!orgs.some((o) => o.id === orgId)) throw new Error("You are not a member of that organization.");
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, cookieOptions);
  revalidatePath("/", "layout");
}
