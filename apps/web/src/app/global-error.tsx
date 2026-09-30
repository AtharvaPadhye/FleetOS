"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@fleetos/ui/components/button";
import "./globals.css";

/**
 * Last-resort error page, shown when the root layout itself fails (NFR OBS-1: the error goes to Sentry).
 * It replaces the root layout, so it brings its own document and global styles.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" data-theme="night">
      <body className="min-h-dvh bg-canvas text-fg">
        <title>Something went wrong · FleetOS</title>
        <main className="mx-auto max-w-md px-6 pt-[20vh]">
          <h1 className="text-title font-semibold">Something went wrong</h1>
          <p className="mt-2 mb-5 text-body text-fg-muted">
            FleetOS hit an unexpected error. It&apos;s been reported{error.digest ? ` (ref ${error.digest})` : ""}.
          </p>
          <Button onClick={() => retry()}>Try again</Button>
        </main>
      </body>
    </html>
  );
}
