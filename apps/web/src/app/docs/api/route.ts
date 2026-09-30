import { ApiReference } from "@scalar/nextjs-api-reference";
import { cspFor, newNonce } from "@/lib/csp";

/**
 * Interactive API reference (Scalar) for /api/v1, rendered from docs/architecture/openapi.yaml via
 * /api/openapi.json. Kept local: no request proxy (Try it calls this app directly, so the session cookie and
 * tokens never pass through a third party), and Scalar's hosted AI agent, MCP generator, toolbar and
 * telemetry are off, since the contract is ours to share. Scalar's web fonts are off too (CSP).
 */
const reference = ApiReference({
  url: "/api/openapi.json",
  pageTitle: "FleetOS API reference",
  darkMode: true,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: "never",
  telemetry: false,
  // No font downloads from fonts.scalar.com; the CSP keeps fonts same-origin (NFR SEC-5).
  withDefaultFonts: false,
  // Same-origin "Try it" requests carry the signed-in session cookie; Bearer tokens work for scripts.
  authentication: { preferredSecurityScheme: "SupabaseSession" },
  metaData: { title: "FleetOS API reference", description: "The FleetOS /api/v1 contract" },
});

// Scalar's page is one inline module script that imports its bundle from jsDelivr. It gets this response's
// nonce, and 'strict-dynamic' trusts what that script imports; nothing else inline may run (NFR SEC-5).
// Scalar's bundle probes for eval once; eval stays blocked (the page works without it) and this page doesn't
// send CSP reports, so that probe doesn't reach Sentry on every view.
const SCALAR_CDN = "https://cdn.jsdelivr.net";

export async function GET() {
  const res = await reference();
  const nonce = newNonce();
  const html = (await res.text()).replaceAll("<script", `<script nonce="${nonce}"`);
  const headers = new Headers(res.headers);
  headers.set("Content-Security-Policy", cspFor(nonce, { scriptOrigins: [SCALAR_CDN], report: false }));
  headers.delete("Content-Length");
  return new Response(html, { status: res.status, headers });
}
