import { buildCsp, newNonce, sentryCspReportUri } from "./csp";

const base = { nonce: "abc123", dev: false, preview: false, supabaseUrl: "https://ref.supabase.co" };
const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((d) => d.startsWith(`${name} `) || d === name)
    ?.split(" ")
    .slice(1);

describe("buildCsp", () => {
  it("allows scripts only by nonce in production", () => {
    const script = directive(buildCsp(base), "script-src");
    expect(script).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("lets the browser reach Supabase over HTTPS and Realtime over WSS, and the map tiles", () => {
    const connect = directive(buildCsp(base), "connect-src");
    expect(connect).toEqual(expect.arrayContaining(["https://ref.supabase.co", "wss://ref.supabase.co"]));
    expect(connect).toContain("https://*.basemaps.cartocdn.com");
  });

  it("uses ws: for a local http Supabase and adds eval only in dev", () => {
    const csp = buildCsp({ ...base, dev: true, supabaseUrl: "http://127.0.0.1:54321" });
    expect(directive(csp, "connect-src")).toContain("ws://127.0.0.1:54321");
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("blocks framing and plugins", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "frame-src")).toEqual(["'none'"]);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("allows Vercel's toolbar on previews only", () => {
    expect(buildCsp(base)).not.toContain("vercel.live");
    const preview = buildCsp({ ...base, preview: true });
    expect(directive(preview, "script-src")).toContain("https://vercel.live");
    expect(directive(preview, "frame-src")).toEqual(["https://vercel.live"]);
  });

  it("adds extra script origins and the report URI when given", () => {
    const csp = buildCsp({ ...base, scriptOrigins: ["https://cdn.jsdelivr.net"], reportUri: "https://r.example/x" });
    expect(directive(csp, "script-src")).toContain("https://cdn.jsdelivr.net");
    expect(directive(csp, "report-uri")).toEqual(["https://r.example/x"]);
  });
});

describe("newNonce", () => {
  it("is 128 bits of base64 and different each time", () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});

describe("sentryCspReportUri", () => {
  it("derives Sentry's security endpoint from the DSN", () => {
    expect(sentryCspReportUri("https://key123@o1.ingest.us.sentry.io/456", "production")).toBe(
      "https://o1.ingest.us.sentry.io/api/456/security/?sentry_key=key123&sentry_environment=production",
    );
  });
  it("is undefined without a DSN", () => {
    expect(sentryCspReportUri(undefined)).toBeUndefined();
  });
});
