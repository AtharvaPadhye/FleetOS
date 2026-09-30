/**
 * Content-Security-Policy for app pages (NFR SEC-5): scripts only with this request's nonce ('strict-dynamic'
 * lets those scripts load their own chunks), no inline scripts otherwise. Styles allow 'unsafe-inline' because
 * React `style={}` attributes, Recharts and MapLibre set inline styles; SEC-5 only forbids inline scripts.
 * To allow a new third-party origin, add it here and to docs/architecture/deployment.md §CSP.
 */

// MapLibre base map: style JSON, vector tiles, glyphs and sprites (components/vehicle/vehicle-map.tsx).
const MAP_ORIGINS = ["https://basemaps.cartocdn.com", "https://*.basemaps.cartocdn.com"];
// Vercel's toolbar and comments, injected into preview deployments only.
const VERCEL_LIVE = "https://vercel.live";

export type CspOptions = {
  nonce: string;
  /** `next dev`: React needs eval for debugging, and there's no HTTPS to upgrade to. */
  dev: boolean;
  /** Vercel preview deployment (VERCEL_ENV=preview). */
  preview: boolean;
  /** Supabase API origin; the browser client calls it over HTTPS and Realtime over WSS. */
  supabaseUrl: string;
  /** Where browsers send violation reports (Sentry's security endpoint); omitted when Sentry is off. */
  reportUri?: string;
  /** Extra script origins, for pages that load a vendor bundle (the API reference). */
  scriptOrigins?: string[];
};

export function buildCsp(o: CspOptions): string {
  const supabase = new URL(o.supabaseUrl);
  const supabaseWs = `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`;
  const live = o.preview ? [VERCEL_LIVE] : [];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${o.nonce}'`,
      "'strict-dynamic'",
      ...(o.scriptOrigins ?? []),
      ...(o.dev ? ["'unsafe-eval'"] : []),
      ...live,
    ],
    "style-src": ["'self'", "'unsafe-inline'", ...live],
    "img-src": ["'self'", "data:", "blob:", ...MAP_ORIGINS, ...live],
    "font-src": ["'self'", ...live],
    "connect-src": ["'self'", supabase.origin, supabaseWs, ...MAP_ORIGINS, ...live],
    "worker-src": ["'self'", "blob:"],
    "frame-src": live.length ? live : ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!o.dev) parts.push("upgrade-insecure-requests");
  if (o.reportUri) parts.push(`report-uri ${o.reportUri}`);
  return parts.join("; ");
}

/** A fresh, unguessable nonce per response (128 bits, base64). */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Sentry's CSP report endpoint for a DSN, or undefined when there's no DSN.
 * https://<key>@<host>/<project> → https://<host>/api/<project>/security/?sentry_key=<key>
 */
export function sentryCspReportUri(dsn: string | undefined, env?: string): string | undefined {
  if (!dsn) return undefined;
  const u = new URL(dsn);
  const project = u.pathname.replace(/^\//, "");
  const q = new URLSearchParams({ sentry_key: u.username, ...(env ? { sentry_environment: env } : {}) });
  return `${u.protocol}//${u.host}/api/${project}/security/?${q}`;
}

/**
 * The policy for this deployment (proxy.ts for pages, app/docs/api/route.ts for the API reference).
 * `report: false` leaves out the Sentry report URI, for pages whose known, harmless violations would only spam it.
 */
export function cspFor(
  nonce: string,
  { scriptOrigins, report = true }: { scriptOrigins?: string[]; report?: boolean } = {},
): string {
  return buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    preview: process.env.VERCEL_ENV === "preview",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    reportUri: report ? sentryCspReportUri(process.env.NEXT_PUBLIC_SENTRY_DSN, process.env.VERCEL_ENV) : undefined,
    scriptOrigins,
  });
}
