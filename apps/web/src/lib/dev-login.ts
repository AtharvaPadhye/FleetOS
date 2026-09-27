/**
 * Local-development auto sign-in, so building the product doesn't mean clicking a magic link after every
 * database reset. Active only under `next dev` with DEV_AUTO_LOGIN_EMAIL set (`pnpm db:env` writes it);
 * `next start`, CI, e2e and production always use the real sign-in flow.
 */
export const DEV_LOGIN_PATH = "/auth/dev-login";

export function devAutoLoginEmail(
  env: { NODE_ENV?: string; DEV_AUTO_LOGIN_EMAIL?: string } = process.env,
): string | null {
  if (env.NODE_ENV !== "development") return null;
  const email = env.DEV_AUTO_LOGIN_EMAIL?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

/** Only same-origin paths; anything else falls back to the home page. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith(DEV_LOGIN_PATH) ? next : "/";
}
