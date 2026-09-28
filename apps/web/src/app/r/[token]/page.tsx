import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import { ReportDocument } from "@/components/reports/report-document";
import { publicEnv } from "@/lib/env";
import { sharedReport } from "@/lib/services/reports";

export const metadata: Metadata = { title: "Asset performance report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A shared report (PRD RP-4, flows.md F5): opens without login, read-only, watermarked with the recipient.
 * Unknown, expired and revoked links look the same and show no data. `?print=1` is the PDF layout.
 */
export default async function SharedReportPage({ params, searchParams }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const print = (await searchParams).print === "1";
  // Anonymous client on purpose: a signed-in visitor's identity plays no part in what a link shows.
  const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await sharedReport(anon, token);
  if (!r) {
    return (
      <main data-theme="paper" className="grid min-h-dvh place-items-center bg-canvas px-4 text-fg">
        <div className="flex max-w-md flex-col gap-2 text-center">
          <h1 className="font-display text-display-l font-semibold">This report link has expired</h1>
          <p className="text-fg-muted">Ask the person who shared it for a new link.</p>
        </div>
      </main>
    );
  }
  const internal = r.recipient === "PDF export";
  return (
    <main data-theme="paper" className={print ? "bg-white" : "relative min-h-dvh bg-canvas px-4 py-8"}>
      {/* Watermark: who this copy was shared with, repeated faintly behind the content. */}
      {!internal ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-10 overflow-hidden opacity-[0.06] select-none print:opacity-[0.05]"
        >
          <div className="text-display-s flex h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 -rotate-[24deg] flex-wrap content-start gap-x-24 gap-y-20 font-semibold text-fg">
            {Array.from({ length: 80 }, (_, i) => (
              <span key={i}>Prepared for {r.recipient}</span>
            ))}
          </div>
        </div>
      ) : null}
      <ReportDocument
        data={r.data}
        version={r.version}
        generatedAt={r.generated_at}
        recipient={internal ? undefined : r.recipient}
      />
      {!print && !internal ? (
        <p className="mx-auto mt-4 max-w-4xl text-center text-label text-fg-muted">
          Shared read-only via FleetOS · link valid until{" "}
          {new Date(r.expires_at).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}
        </p>
      ) : null}
    </main>
  );
}
