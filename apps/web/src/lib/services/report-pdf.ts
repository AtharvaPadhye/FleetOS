import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiProblem } from "@/lib/api/problem";
import type { OrgContext } from "@/lib/api/handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { getReport, shareReport } from "./reports";

/**
 * Report PDF (PRD RP-3): rendered once per report version with headless Chromium from the report's own share
 * view (so it matches the screen exactly), stored privately, then served through a short-lived signed URL.
 * The render uses a 5-minute internal link; nothing else about it is public.
 */
const BUCKET = "report-pdfs";

export async function reportPdfUrl(db: SupabaseClient, org: Pick<OrgContext, "id">, reportId: string, origin: string) {
  const report = await getReport(db, org, reportId);
  let path = report.pdf_path;
  if (!path) {
    path = `${org.id}/reports/${report.id}.pdf`;
    const link = await shareReport(db, org, report.id, { recipient: "PDF export", days: 1, origin, internal: true });
    const pdf = await renderPdf(`${origin}/r/${link.token}?print=1`, `${report.month} v${report.version}`);
    const admin = createAdminClient(); // storage writes are the server's; users can only read (money roles)
    const up = await admin.storage.from(BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (up.error) throw new ApiProblem("internal", up.error.message);
    const { error } = await admin.rpc("engine_set_report_pdf", { p_id: report.id, p_path: path });
    if (error) throw new ApiProblem("internal", error.message);
  }
  const signed = await db.storage.from(BUCKET).createSignedUrl(path, 300, {
    download: `fleetos-report-${report.month}-v${report.version}.pdf`,
  });
  if (signed.error) throw new ApiProblem("internal", signed.error.message);
  return signed.data.signedUrl;
}

async function renderPdf(url: string, label: string): Promise<Uint8Array> {
  let chromium: typeof import("playwright-core").chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new ApiProblem("upstream_unavailable", "PDF export isn't available on this server yet.");
  }
  const browser = await chromium.launch().catch(() => {
    throw new ApiProblem("upstream_unavailable", "PDF export isn't available on this server yet (no Chromium).");
  });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "print" });
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    if (!res?.ok()) throw new ApiProblem("internal", `The report page answered ${res?.status()}.`);
    return await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;font-size:8px;color:#56616e;padding:0 14mm;display:flex;justify-content:space-between"><span>FleetOS · ${label.replace(/</g, "")}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
}
