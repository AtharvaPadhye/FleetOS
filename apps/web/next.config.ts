import type { NextConfig } from "next";

// Baseline security headers (NFR SEC-5). A nonce-based Content-Security-Policy is added in task 2.6.
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
