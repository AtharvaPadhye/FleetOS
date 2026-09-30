import type { ErrorEvent } from "@sentry/nextjs";

/**
 * Sentry options shared by the browser, Node and edge SDKs (NFR OBS-1). Off without a DSN (local dev, CI,
 * forks). No PII: no IPs or cookies, no session replay, and share/invite tokens and auth codes are cut out of
 * URLs before an event leaves the process.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Secret path segments (lender share links, invitations) and query params (auth codes, tokens).
const SECRET_PATH = /\/(r|invite)\/[^/?#]+/g;
const SECRET_QUERY = /([?&](?:code|token|token_hash|access_token|refresh_token)=)[^&#]*/gi;

export function scrubUrl(url: string): string {
  return url.replace(SECRET_PATH, "/$1/[token]").replace(SECRET_QUERY, "$1[redacted]");
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    delete event.request.data;
  }
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  for (const b of event.breadcrumbs ?? []) {
    for (const key of ["url", "from", "to"] as const) {
      const v = b.data?.[key];
      if (typeof v === "string") b.data![key] = scrubUrl(v);
    }
  }
  delete event.user;
  return event;
}

export const sentryOptions = {
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "development",
  sendDefaultPii: false,
  // Errors only for now; tracing (p95 latency, OBS-3) comes with the Phase 4 worker.
  tracesSampleRate: 0,
  // A visitor navigated away while a page was still streaming; not a fault.
  ignoreErrors: ["The destination stream closed early"],
  beforeSend: scrubEvent,
};
