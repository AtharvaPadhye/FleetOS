import { expect, test } from "@playwright/test";
import { OPERATIONS } from "../src/lib/api/operations";

/** API reference (/docs/api) and its annotated spec. Scalar's UI itself loads from a CDN, so it isn't asserted here. */

test.skip(({ isMobile }) => isMobile, "Server responses don't depend on the viewport.");

test("the annotated spec marks implemented operations and prefills the active org", async ({ request }) => {
  const res = await request.get("/api/openapi.json");
  expect(res.status()).toBe(200);
  const spec = await res.json();
  expect(spec.info["x-fleetos-coverage"].implemented).toBe(OPERATIONS.length);
  expect(spec.paths["/vehicles"].get["x-fleetos-implemented"]).toBe(true);
  expect(spec.paths["/vehicles/{id}/commands"].get["x-fleetos-implemented"]).toBe(false);
  expect(spec.servers[0].url).toMatch(/\/api\/v1$/);
  const me = await (await request.get("/api/v1/me")).json();
  expect(spec.components.parameters.OrgHeader.example).toBe(me.memberships[0].org.id);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("the reference page and spec are public, without an org", async ({ request }) => {
    const page = await request.get("/docs/api", { maxRedirects: 0 });
    expect(page.status()).toBe(200);
    expect(page.headers()["content-type"]).toContain("text/html");
    expect(await page.text()).toContain("/api/openapi.json");
    const spec = await (await request.get("/api/openapi.json")).json();
    expect(spec.components.parameters.OrgHeader.example).toBeUndefined();
  });
});
