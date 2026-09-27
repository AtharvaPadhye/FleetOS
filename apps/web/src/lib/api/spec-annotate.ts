/**
 * Prepares docs/architecture/openapi.yaml for the API reference page (/docs/api): points "Try it" at this
 * deployment and marks every operation implemented or planned, from the same registry the routes and the
 * contract test use, so the docs never offer an endpoint as callable when it would 404.
 */
type Json = Record<string, unknown>;
const METHODS = ["get", "post", "put", "patch", "delete"];

export function annotateSpec(
  spec: Json,
  implemented: ReadonlySet<string>,
  origin: string,
  activeOrgId: string | null = null,
): Json {
  const out = structuredClone(spec);
  out.servers = [{ url: `${origin}/api/v1`, description: "This deployment" }];
  const info = out.info as Json;
  info.description = `${info.description ?? ""}\n\n**Implemented** operations are callable here now; **Planned** ones are specified but not built yet (they answer 404). In "Try it", your browser session signs you in; set \`X-FleetOS-Org\` to an org id from \`GET /me\`.`;
  // Prefill the org header in "Try it" with the viewer's active org.
  const orgHeader = ((out.components as Json | undefined)?.parameters as Json | undefined)?.OrgHeader as
    Json | undefined;
  if (orgHeader && activeOrgId) orgHeader.example = activeOrgId;
  let built = 0;
  let planned = 0;
  for (const [path, ops] of Object.entries(out.paths as Json)) {
    for (const [method, op] of Object.entries(ops as Json)) {
      if (!METHODS.includes(method)) continue;
      const o = op as Json;
      const isBuilt = implemented.has(`${method.toUpperCase()} ${path}`);
      o["x-fleetos-implemented"] = isBuilt;
      if (isBuilt) built++;
      else {
        planned++;
        o.summary = `${o.summary ?? o.operationId} (planned)`;
        o.description = `**Planned: not built yet.** Calling it returns 404.${o.description ? `\n\n${o.description}` : ""}`;
      }
    }
  }
  info["x-fleetos-coverage"] = { implemented: built, planned };
  return out;
}
