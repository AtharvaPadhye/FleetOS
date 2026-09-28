import { NextResponse } from "next/server";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ApiProblem } from "@/lib/api/problem";
import { reportPdfUrl } from "@/lib/services/report-pdf";

export const dynamic = "force-dynamic";

/** Export PDF (RP-3): render on first request, then redirect to a short-lived signed download link. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { activeOrg } = await getAppContext();
  if (!activeOrg || !["owner", "admin", "finance"].includes(activeOrg.role))
    return new Response("Reports are for owners, admins and finance.", { status: 403 });
  const { id } = await params;
  try {
    const url = await reportPdfUrl(await createClient(), activeOrg, id, new URL(request.url).origin);
    return NextResponse.redirect(url, 302);
  } catch (e) {
    const status =
      e instanceof ApiProblem ? (e.code === "not_found" ? 404 : e.code === "upstream_unavailable" ? 503 : 500) : 500;
    return new Response(e instanceof Error ? e.message : "PDF export failed.", { status });
  }
}
