import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { DEV_LOGIN_PATH, devAutoLoginEmail } from "@/lib/dev-login";
import { cspFor, newNonce } from "@/lib/csp";

/**
 * Runs before every page request (Next 16 `proxy`, formerly middleware): refreshes the Supabase session
 * cookie and keeps signed-out visitors out of the app (NFR SEC-2). Public: sign-in, auth callback,
 * design reference pages, health check. It also gives every request an `x-request-id` (NFR OBS-2; pages,
 * server actions and /api/v1 log and report errors with it) and pages a nonce-based CSP (NFR SEC-5, lib/csp.ts).
 */
// /api/* is never redirected: /api/v1 answers 401 JSON itself (lib/api/handler.ts) and /api/internal/* checks
// its own bearer secret. /docs/api is the public API reference (the contract isn't secret).
// "/r/": lender share links open without an account (task 5.9, PRD RP-4); the token is the only key.
const PUBLIC_PREFIXES = ["/sign-in", "/auth/", "/design", "/docs/", "/api/", "/r/"];
const isPublic = (path: string) => PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));

// JSON APIs need no CSP; /docs/api sets its own (it loads Scalar from a CDN, app/docs/api/route.ts).
const ownCsp = (path: string) => path.startsWith("/api/") || path === "/docs/api";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const requestId = request.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
  const csp = ownCsp(path) ? undefined : cspFor(newNonce());
  // Next reads the nonce from the request's CSP header and puts it on its own scripts while rendering.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    if (csp) headers.set("content-security-policy", csp);
    return NextResponse.next({ request: { headers } });
  };
  const stamp = (res: NextResponse) => {
    res.headers.set("X-Request-Id", requestId);
    if (csp) res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  let response = forward();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = forward();
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    },
  );

  // Verifies the JWT (signature + expiry) rather than trusting the cookie.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  // Local dev with DEV_AUTO_LOGIN_EMAIL: skip the sign-in page entirely (lib/dev-login.ts).
  if (!signedIn && devAutoLoginEmail() && (path === "/sign-in" || !isPublic(path))) {
    const url = request.nextUrl.clone();
    url.pathname = DEV_LOGIN_PATH;
    const next = path === "/sign-in" ? request.nextUrl.searchParams.get("next") : path + request.nextUrl.search;
    url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
    return stamp(withCookies(NextResponse.redirect(url), response));
  }
  if (!signedIn && !isPublic(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return stamp(withCookies(NextResponse.redirect(url), response));
  }
  if (signedIn && path === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return stamp(withCookies(NextResponse.redirect(url), response));
  }
  return stamp(response);
}

/** Carry refreshed session cookies onto a redirect. */
function withCookies(redirect: NextResponse, from: NextResponse) {
  for (const c of from.cookies.getAll()) redirect.cookies.set(c);
  return redirect;
}

export const config = {
  // /monitoring is the Sentry tunnel (next.config.ts): browser error reports must reach it signed in or not.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|monitoring|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pem|mjs)$).*)"],
};
