# Deployment (prototype, ADR-0014)

> Roadmap task 2.6 · 2026-09-30. How the live prototype is wired, who owns each piece, and where each setting lives.

## Who owns what

| Piece | Where | Owner | Notes |
|---|---|---|---|
| Web app | Vercel project `fleet-os` → https://fleet-os-omega.vercel.app | Atharva (Hobby) | Deploys `main` on push; PR branches get preview URLs `fleet-os-*-atharvapadhye.vercel.app`. |
| Database, auth, realtime, storage | Supabase project `FleetOS` (`lqycrqkadcchsosklxns`, us-east-1) | Akshat | Same region as Vercel's default function region (iad1). Previews share it. |
| Error reporting | Sentry project `fleetos` | Akshat | Free Developer plan. |
| Sign-in email | Gmail SMTP (Supabase → Authentication → Emails) | Akshat | ~500/day. Moves to Resend with our own domain in task 4.0. |

Hosting is split across two accounts; that's fine because the pieces only talk over URLs and keys.

## Where each value lives

| Value | Where | Why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN` | `apps/web/.env.production` (committed) | Public by design (they reach every browser). Committed so the build works without Vercel dashboard access. `.env.local` and real env vars override it, so local dev and CI use the local stack with Sentry off. |
| `SUPABASE_SECRET_KEY`, `TICK_SECRET` | Vercel → Settings → Environment Variables (Sensitive) | Secrets; never in git (NFR SEC-4). Only read at runtime: onboarding's demo fleet and the simulator tick. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Vercel, optional | Only for uploading source maps at build; without them stack traces are minified. |
| Auth Site URL + redirect URLs | `supabase/config.toml` `[remotes.production]` → `pnpm exec supabase config push` | The block pins the hosted project's own defaults so a push changes only what we mean to. Run `supabase config diff` first. |
| Migrations | `supabase/migrations/` → `pnpm exec supabase db push` | Needs `pnpm exec supabase login` once (in a real terminal) and `supabase link --project-ref lqycrqkadcchsosklxns`. |

Gitleaks allows `sb_publishable_…` keys (`.gitleaks.toml`); `sb_secret_…` keys stay flagged.

## Simulator tick on the hosted project

pg_cron calls the tick every minute (ADR-0014). Locally `supabase/seed.sql` registers it; on the hosted project run
this once in the SQL editor, with the same value as Vercel's `TICK_SECRET`:

```sql
select vault.create_secret('<TICK_SECRET>', 'tick_secret', 'Bearer for /api/internal/tick');
select cron.schedule('engine-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://fleet-os-omega.vercel.app/api/internal/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'tick_secret'))
  ) $$);
```

## Content-Security-Policy (NFR SEC-5)

`apps/web/src/proxy.ts` gives every page a fresh nonce and the policy from `apps/web/src/lib/csp.ts`; Next puts the
nonce on its own scripts. All pages render per request (root layout calls `connection()`), since a prerendered page
has no nonce.

- Scripts: `'self'`, the nonce, `'strict-dynamic'`. No inline scripts, no eval (dev adds `'unsafe-eval'` for React).
- Styles: `'unsafe-inline'` allowed (React `style={}`, Recharts, MapLibre); SEC-5 only forbids inline scripts.
- Connections: Supabase over HTTPS and WSS, Carto base-map tiles. Sentry goes through the same-origin `/monitoring`
  tunnel. Preview deployments also allow `https://vercel.live` (Vercel toolbar).
- Violations are reported to Sentry (`report-uri`).
- `/docs/api` (Scalar) sets its own policy in its route handler: its one inline script gets the nonce and may import
  from jsDelivr; Scalar's web fonts are off. Its bundle probes for eval once, which stays blocked and isn't reported.
- The browser sets Zod to `jitless` (`instrumentation-client.ts`) so Zod's eval probe doesn't trip the policy.

**Adding a third-party origin:** add it to `lib/csp.ts`, cover it in `lib/csp.test.ts`, and make sure
`e2e/security.spec.ts` (which fails on any violation) visits a page that uses it.

## Errors and logs (NFR OBS-1, OBS-2)

- **Sentry** (`src/instrumentation*.ts`, `src/lib/sentry.ts`): server, edge and browser errors, tagged with
  `request_id`, `org_id` and the environment (`production` / `preview`). No IPs, cookies, headers, bodies or users;
  share/invite tokens and auth codes are cut out of URLs. Errors only, no tracing yet (OBS-3 comes with the worker).
- **Request ids:** the proxy sets `x-request-id` on every request and response (keeping a caller's own id); `/api/v1`
  errors return it as `request_id`.
- **Logs** (`src/lib/log.ts`): one JSON object per line with `event`, `request_id`, `org_id`; secret-looking fields
  are redacted. Read them in Vercel → Logs (filter by `request_id`).

## Known gaps

- Report PDF export launches Chromium through `playwright-core`, which Vercel functions don't provide. Needs its own
  task before reports are demoed live.
