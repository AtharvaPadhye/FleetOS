import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionDemoFleet } from "@/lib/engine/demo";
import { devAutoLoginEmail, safeNext } from "@/lib/dev-login";

/**
 * Dev-only: signs in DEV_AUTO_LOGIN_EMAIL without an email round-trip. Creates the user on first use and,
 * if they belong to no org, a demo org they own. 404 outside `next dev` (see lib/dev-login.ts).
 */
export async function GET(request: NextRequest) {
  const email = devAutoLoginEmail();
  if (!email) return new NextResponse("Not found", { status: 404 });
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && created.error.code !== "email_exists") return fail(`create user: ${created.error.message}`);

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) return fail(`generate link: ${link.error.message}`);

  const supabase = await createClient();
  const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token });
  if (verified.error || !verified.data.user) return fail(`verify: ${verified.error?.message ?? "no user"}`);

  const response = NextResponse.redirect(new URL(next, request.nextUrl.origin));
  const { count } = await admin
    .from("memberships")
    .select("org_id", { count: "exact", head: true })
    .eq("user_id", verified.data.user.id);
  if (!count) {
    // create_org runs as the user (auth.uid()), so they become the owner.
    const { data, error } = await supabase.rpc("create_org", {
      p_name: "Atlas Mobility (demo)",
      p_slug: `atlas-demo-${Math.random().toString(36).slice(2, 7)}`,
      p_timezone: "America/Phoenix",
      p_city: "Phoenix, AZ",
    });
    if (error) return fail(`create org: ${error.message}`);
    const orgId = (data as { id: string }).id;
    await provisionDemoFleet(admin, orgId, Math.floor(Math.random() * 2 ** 31));
    response.cookies.set(ACTIVE_ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
  }
  return response;
}

function fail(message: string) {
  return new NextResponse(`Dev auto-login failed (${message}). Run \`pnpm db:start && pnpm db:env\`.`, {
    status: 500,
  });
}
