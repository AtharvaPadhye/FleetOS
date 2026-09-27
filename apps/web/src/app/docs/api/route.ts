import { ApiReference } from "@scalar/nextjs-api-reference";

/**
 * Interactive API reference (Scalar) for /api/v1, rendered from docs/architecture/openapi.yaml via
 * /api/openapi.json. Kept local: no request proxy (Try it calls this app directly, so the session cookie and
 * tokens never pass through a third party), and Scalar's hosted AI agent, MCP generator, toolbar and
 * telemetry are off, since the contract is ours to share.
 */
export const GET = ApiReference({
  url: "/api/openapi.json",
  pageTitle: "FleetOS API reference",
  darkMode: true,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: "never",
  telemetry: false,
  // Same-origin "Try it" requests carry the signed-in session cookie; Bearer tokens work for scripts.
  authentication: { preferredSecurityScheme: "SupabaseSession" },
  metaData: { title: "FleetOS API reference", description: "The FleetOS /api/v1 contract" },
});
