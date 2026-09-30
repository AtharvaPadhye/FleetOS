import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Baseline security headers (NFR SEC-5). The nonce-based Content-Security-Policy is per request (proxy.ts).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Workspace packages ship TypeScript source (no build step); Next compiles it.
  transpilePackages: ["@fleetos/ui", "@fleetos/domain", "@fleetos/providers", "@fleetos/engine"],
  // The API reference (/api/openapi.json) reads the spec from the repo's docs at runtime.
  outputFileTracingIncludes: { "/api/openapi.json": ["../../docs/architecture/openapi.yaml"] },
  // Report PDFs launch headless Chromium at runtime (task 5.9); never bundle the driver.
  serverExternalPackages: ["playwright-core"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Sentry (NFR OBS-1): browser events go through the same-origin /monitoring tunnel, so the CSP stays 'self' and
// ad blockers don't drop them. Source maps upload only when SENTRY_AUTH_TOKEN (+ SENTRY_ORG, SENTRY_PROJECT)
// is set at build time; without them the build skips the upload and stack traces stay minified.
export default withSentryConfig(nextConfig, {
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
