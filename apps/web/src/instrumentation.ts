import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

/** Server and edge error reporting (NFR OBS-1). Unhandled errors in pages, actions and routes go to Sentry. */
export function register() {
  Sentry.init(sentryOptions);
}

export const onRequestError = Sentry.captureRequestError;
