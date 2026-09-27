import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiProblem } from "./handler";
import { decodeCursor, encodeCursor, isKeysetCursor } from "./cursor";

/**
 * Newest-first history pages for one vehicle (or the whole org when `vehicleId` is null), keyset-paginated on (time, id) so pages stay fast and stable
 * as rows keep arriving. `from`/`to` are half-open.
 */
export async function historyPage<Row extends { id: string | number }>(
  db: SupabaseClient,
  opts: {
    table: string;
    columns: string;
    timeColumn: string;
    orgId: string;
    vehicleId: string | null;
    query: { from?: string; to?: string; limit: number; cursor?: string };
  },
): Promise<{ rows: Row[]; nextCursor: string | null; total: number }> {
  const { table, columns, timeColumn: t, orgId, vehicleId, query } = opts;
  if (vehicleId) {
    const { count: exists } = await db
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("id", vehicleId);
    if (!exists) throw new ApiProblem("not_found", "No such vehicle.");
  }

  const cursor = decodeCursor(query.cursor, isKeysetCursor);
  const base = () => {
    let q = db.from(table).select(columns, { count: "exact" }).eq("org_id", orgId);
    if (vehicleId) q = q.eq("vehicle_id", vehicleId);
    if (query.from) q = q.gte(t, query.from);
    if (query.to) q = q.lt(t, query.to);
    return q;
  };
  let q = base();
  if (cursor) q = q.or(`${t}.lt."${cursor.at}",and(${t}.eq."${cursor.at}",id.lt."${cursor.id}")`);
  const { data, count, error } = await q
    .order(t, { ascending: false })
    .order("id", { ascending: false })
    .limit(query.limit + 1)
    .returns<(Row & Record<string, unknown>)[]>();
  if (error) throw new ApiProblem("internal", error.message);
  const rows = (data ?? []).slice(0, query.limit);
  const last = rows.at(-1);
  const nextCursor =
    (data ?? []).length > query.limit && last
      ? encodeCursor({ at: new Date(last[t] as string).toISOString(), id: String(last.id) })
      : null;
  // `total` counts the whole filtered history, not just what's left after the cursor.
  const total = cursor ? ((await base().limit(0)).count ?? 0) : (count ?? 0);
  return { rows, nextCursor, total };
}
