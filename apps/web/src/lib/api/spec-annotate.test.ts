import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OPERATIONS } from "./operations";
import { annotateSpec } from "./spec-annotate";

const spec = parse(readFileSync(join(__dirname, "../../../../../docs/architecture/openapi.yaml"), "utf8"));
const implemented = new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`));

describe("annotateSpec", () => {
  const out = annotateSpec(spec, implemented, "http://localhost:3000") as {
    servers: { url: string }[];
    info: Record<string, unknown>;
    paths: Record<string, Record<string, { summary: string; "x-fleetos-implemented": boolean }>>;
  };
  it("points Try it at this deployment", () => {
    expect(out.servers).toEqual([{ url: "http://localhost:3000/api/v1", description: "This deployment" }]);
  });
  it("marks exactly the registered operations as implemented", () => {
    expect(out.info["x-fleetos-coverage"]).toMatchObject({ implemented: OPERATIONS.length });
    expect(out.paths["/vehicles"]!.get!["x-fleetos-implemented"]).toBe(true);
    expect(out.paths["/tickets"]!.get!["x-fleetos-implemented"]).toBe(false);
    expect(out.paths["/tickets"]!.get!.summary).toMatch(/\(planned\)$/);
  });
  it("doesn't modify the source spec", () => {
    expect(spec.servers[0].url).not.toContain("localhost");
  });
  it("prefills the org header with the viewer's active org", () => {
    const withOrg = annotateSpec(spec, implemented, "http://x", "820c927a-c6cc-4d31-845f-c0ee35d194a1") as {
      components: { parameters: { OrgHeader: { example?: string } } };
    };
    expect(withOrg.components.parameters.OrgHeader.example).toBe("820c927a-c6cc-4d31-845f-c0ee35d194a1");
    expect((out as unknown as typeof withOrg).components.parameters.OrgHeader.example).toBeUndefined();
  });
});
