import { apiRoute } from "@/lib/api/handler";
import { getInvitations, postInvitation } from "@/lib/api/operations";
import { invite, listInvitations } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export const GET = apiRoute(getInvitations, async ({ db, org }) => ({ body: await listInvitations(db, org) }));

/** Invite by email (owner/admin): emails a 7-day link; a pending invite to the same address is replaced. */
export const POST = apiRoute(postInvitation, async ({ db, org, body, request }) => {
  const { data } = await db.from("orgs").select("name").eq("id", org.id).single();
  const r = await invite(db, org, {
    email: body.email,
    role: body.role,
    orgName: (data?.name as string | undefined) ?? "FleetOS",
    origin: new URL(request.url).origin,
  });
  return { body: { id: r.id, email: r.email, role: r.role, expires_at: r.expires_at }, status: 201 };
});
