import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { sentryOptions } from "@/lib/sentry";

// Zod 4 probes for eval (`Function("")`) to speed up parsing; the CSP forbids eval (NFR SEC-5), so the probe
// would be reported as a violation on every page. Parse without it.
z.config({ jitless: true });

/** Browser error reporting (NFR OBS-1), sent through the same-origin /monitoring tunnel (next.config.ts). */
Sentry.init(sentryOptions);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
