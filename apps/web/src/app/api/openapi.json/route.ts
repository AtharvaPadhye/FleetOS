import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { OPERATIONS } from "@/lib/api/operations";
import { annotateSpec } from "@/lib/api/spec-annotate";
import { getAppContext } from "@/lib/session";

export const dynamic = "force-dynamic";

// The spec lives with the architecture docs; next.config.ts traces it into the build.
const SPEC = join(process.cwd(), "../../docs/architecture/openapi.yaml");
const implemented = new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`));

/** The API contract as JSON for the reference page, annotated with what's implemented. Not secret. */
export async function GET(request: Request) {
  const [spec, { activeOrg }] = await Promise.all([
    readFile(SPEC, "utf8").then((t) => parse(t) as Record<string, unknown>),
    getAppContext(),
  ]);
  return Response.json(annotateSpec(spec, implemented, new URL(request.url).origin, activeOrg?.id ?? null), {
    headers: { "Cache-Control": "no-store" },
  });
}
