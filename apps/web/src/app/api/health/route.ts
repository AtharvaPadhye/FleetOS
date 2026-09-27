/** Liveness probe for uptime monitoring and CI smoke tests (outside the versioned /api/v1 surface). */
export function GET() {
  return Response.json(
    { status: "ok", service: "fleetos-web", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
