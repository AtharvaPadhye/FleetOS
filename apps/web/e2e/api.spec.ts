import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { uniqueEmail } from "./helpers/auth";

/** /api/v1 platform endpoints (task 3.8a): auth, org scoping, error shape, headers. */

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "API behaviour doesn't depend on the viewport.");

test("with the browser session: /me, /orgs and /capabilities for the active org", async ({ request }) => {
  const me = await request.get("/api/v1/me");
  expect(me.status()).toBe(200);
  expect(me.headers()["x-fleetos-stability"]).toBe("stable");
  expect(me.headers()["x-request-id"]).toBeTruthy();
  const body = await me.json();
  const orgId = body.memberships[0].org.id as string;
  expect(body.memberships[0].role).toBe("owner");

  const orgs = await request.get("/api/v1/orgs");
  expect((await orgs.json()).map((o: { id: string }) => o.id)).toContain(orgId);

  const caps = await request.get("/api/v1/capabilities", { headers: { "X-FleetOS-Org": orgId } });
  expect(caps.status()).toBe(200);
  const { capabilities } = await caps.json();
  expect(capabilities).toHaveLength(9);
  expect(capabilities.find((c: { name: string }) => c.name === "tesla")).toMatchObject({ state: "unavailable" });
});

test("org scoping: missing header is 400, someone else's org is 404", async ({ request }) => {
  const missing = await request.get("/api/v1/capabilities");
  expect(missing.status()).toBe(400);
  expect(await missing.json()).toMatchObject({ error: "invalid_request", request_id: expect.any(String) });

  const foreign = await request.get("/api/v1/capabilities", {
    headers: { "X-FleetOS-Org": "00000000-0000-0000-0000-000000000000" },
  });
  expect(foreign.status()).toBe(404);
  expect(await foreign.json()).toMatchObject({ error: "not_found" });
});

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("answers 401 JSON instead of redirecting to sign-in", async ({ request }) => {
    const res = await request.get("/api/v1/me", { maxRedirects: 0 });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
    const bad = await request.get("/api/v1/me", { headers: { Authorization: "Bearer not-a-jwt" } });
    expect(bad.status()).toBe(401);
  });

  test("accepts a user's Bearer token", async ({ request }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
    const email = uniqueEmail("api");
    await admin.auth.admin.createUser({ email, email_confirm: true });
    const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    expect(error).toBeNull();
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties!.hashed_token });
    const res = await request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${data.session!.access_token}` },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ email, memberships: [] });
  });
});
