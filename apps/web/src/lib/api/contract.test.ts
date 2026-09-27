import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { OPERATIONS } from "./operations";
import { CapabilityUnavailable } from "./schemas";

/**
 * The API contract check (task 3.8, docs/architecture/api.md): every implemented operation must match
 * docs/architecture/openapi.yaml. The implementation may send less than the spec allows (optional fields,
 * a subset of an enum) but never more or different: no undocumented fields, types, formats or nulls.
 */

type Json = Record<string, unknown>;
const ROOT = join(__dirname, "../../../../..");
const spec = parse(readFileSync(join(ROOT, "docs/architecture/openapi.yaml"), "utf8")) as Json;

interface Norm {
  type?: string;
  nullable?: boolean;
  format?: string;
  enum?: string[];
  properties?: Record<string, Norm>;
  required?: string[];
  items?: Norm;
  additional?: Norm;
  union?: Norm[];
}

function resolve(s: Json): Json {
  let cur = s;
  while (typeof cur.$ref === "string") {
    cur = (cur.$ref as string)
      .replace(/^#\//, "")
      .split("/")
      .reduce<Json>((o, k) => o[k] as Json, spec);
  }
  return cur;
}

function norm(input: unknown): Norm {
  const s = resolve((input ?? {}) as Json);
  if (Array.isArray(s.allOf)) {
    const parts = (s.allOf as Json[]).map(norm);
    return {
      type: "object",
      properties: Object.assign({}, ...parts.map((p) => p.properties ?? {})),
      required: [...new Set(parts.flatMap((p) => p.required ?? []))],
    };
  }
  const variants = (s.oneOf ?? s.anyOf) as Json[] | undefined;
  if (variants) {
    const nonNull = variants.filter((v) => resolve(v).type !== "null");
    const nullable = nonNull.length < variants.length;
    if (nonNull.length === 1) return { ...norm(nonNull[0]), ...(nullable ? { nullable } : {}) };
    return { union: nonNull.map(norm), ...(nullable ? { nullable } : {}) };
  }
  const out: Norm = {};
  let type = s.type;
  if (Array.isArray(type)) {
    if (type.includes("null")) out.nullable = true;
    type = type.filter((t) => t !== "null")[0];
  }
  if (typeof type === "string") out.type = type;
  if (typeof s.format === "string") out.format = s.format;
  if (s.const !== undefined) {
    out.enum = [String(s.const)];
    out.type ??= typeof s.const;
  }
  if (Array.isArray(s.enum)) {
    out.enum = (s.enum as unknown[])
      .filter((e) => e !== null)
      .map(String)
      .sort();
    if ((s.enum as unknown[]).includes(null)) out.nullable = true;
  }
  if (out.type === "object") {
    if (s.properties)
      out.properties = Object.fromEntries(Object.entries(s.properties as Json).map(([k, v]) => [k, norm(v)]));
    out.required = [...((s.required as string[]) ?? [])].sort();
    if (s.additionalProperties && typeof s.additionalProperties === "object")
      out.additional = norm(s.additionalProperties);
  }
  if (out.type === "array") out.items = norm(s.items);
  return out;
}

/** Problems where `impl` (from zod) could send something `api` (the spec) doesn't allow. */
function diff(impl: Norm, api: Norm, at: string): string[] {
  if (api.union) return impl.union || impl.type ? [] : [`${at}: expected one of the spec's variants`];
  if (!api.type && !api.enum) return []; // an untyped spec schema ({}) allows any value
  const out: string[] = [];
  if (impl.type !== api.type) return [`${at}: type ${impl.type} ≠ spec ${api.type}`];
  if (impl.nullable && !api.nullable) out.push(`${at}: may be null, spec says it can't`);
  if ((impl.format ?? null) !== (api.format ?? null))
    out.push(`${at}: format ${impl.format ?? "none"} ≠ spec ${api.format ?? "none"}`);
  if (api.enum) {
    const extra = (impl.enum ?? ["<any string>"]).filter((e) => !api.enum!.includes(e));
    if (extra.length) out.push(`${at}: values not in the spec enum: ${extra.join(", ")}`);
  }
  if (impl.type === "object" && api.properties) {
    const implProps = impl.properties ?? {};
    for (const k of Object.keys(implProps))
      if (!(k in api.properties)) out.push(`${at}.${k}: not in the spec`);
      else out.push(...diff(implProps[k]!, api.properties[k]!, `${at}.${k}`));
    for (const k of api.required ?? [])
      if (!(impl.required ?? []).includes(k)) out.push(`${at}.${k}: required by the spec but optional here`);
  }
  if (impl.type === "object" && api.additional && impl.additional)
    out.push(...diff(impl.additional, api.additional, `${at}{*}`));
  if (impl.type === "array" && api.items && impl.items) out.push(...diff(impl.items, api.items, `${at}[]`));
  return out;
}

/** Request bodies: the implementation must accept every documented field and require no more than the spec. */
function diffRequest(impl: Norm, api: Norm, at: string): string[] {
  const out: string[] = [];
  if (impl.type !== api.type) return [`${at}: type ${impl.type} ≠ spec ${api.type}`];
  if (impl.type === "object" && api.properties) {
    const implProps = impl.properties ?? {};
    for (const k of Object.keys(api.properties))
      if (!(k in implProps)) out.push(`${at}.${k}: documented but not accepted`);
    for (const k of Object.keys(implProps)) if (!(k in api.properties)) out.push(`${at}.${k}: not in the spec`);
    for (const k of impl.required ?? [])
      if (!(api.required ?? []).includes(k)) out.push(`${at}.${k}: required here but optional in the spec`);
  }
  return out;
}

const specOp = (method: string, path: string) =>
  ((spec.paths as Json)[path] as Json | undefined)?.[method.toLowerCase()] as Json | undefined;

describe("implemented /api/v1 operations match openapi.yaml", () => {
  for (const o of OPERATIONS) {
    describe(`${o.method} ${o.path}`, () => {
      const s = specOp(o.method, o.path);
      it("exists in the spec with the same id and stability", () => {
        expect(s, "missing from openapi.yaml").toBeDefined();
        expect(s!.operationId).toBe(o.operationId);
        expect(s!["x-fleetos-stability"]).toBe(o.stability);
      });
      it("accepts only query parameters the spec documents", () => {
        const documented = ((s?.parameters as Json[]) ?? []).map(resolve).filter((p) => p.in === "query");
        const names = documented.map((p) => p.name as string);
        const shape = (o.query as unknown as z.ZodObject).shape as Record<string, z.ZodType>;
        expect(Object.keys(shape).filter((k) => !names.includes(k))).toEqual([]);
        for (const p of documented.filter((p) => (p.name as string) in shape)) {
          const impl = norm(z.toJSONSchema(shape[p.name as string]!, { io: "input" }));
          const api = norm(p.schema);
          // Query strings are text: a documented boolean arrives as "true" / "false".
          if (
            api.type === "boolean" &&
            impl.type === "string" &&
            impl.enum?.every((v) => v === "true" || v === "false")
          )
            continue;
          expect(diff(impl, api, `?${p.name}`)).toEqual([]);
        }
      });
      it("reads the documented request body", () => {
        const documented = ((s?.requestBody as Json | undefined)?.content as Json | undefined)?.["application/json"] as
          Json | undefined;
        expect(Boolean(o.body), "request body declared in one place but not the other").toBe(Boolean(documented));
        if (o.body && documented)
          expect(diffRequest(norm(z.toJSONSchema(o.body, { io: "input" })), norm(documented.schema), "body")).toEqual(
            [],
          );
      });
      it("declares its capability when preview, and documents the 501", () => {
        expect(Boolean(o.capability)).toBe(o.stability === "preview");
        if (o.stability === "preview") expect(Object.keys((s?.responses as Json) ?? {})).toContain("501");
      });
      it("returns the documented response shape", () => {
        const responses = (s?.responses as Json) ?? {};
        const ok = (responses["200"] ?? responses["201"]) as Json;
        const media = ((resolve(ok).content as Json)["application/json"] as Json).schema;
        expect(diff(norm(z.toJSONSchema(o.response)), norm(media), "response")).toEqual([]);
      });
    });
  }
});

describe("preview operations (ADR-0006)", () => {
  it("every preview operation in the spec is implemented", () => {
    const inSpec = Object.entries(spec.paths as Json).flatMap(([path, ops]) =>
      Object.entries(ops as Json)
        .filter(([, o]) => (o as Json)["x-fleetos-stability"] === "preview")
        .map(([m]) => `${m.toUpperCase()} ${path}`),
    );
    const implemented = OPERATIONS.filter((o) => o.stability === "preview").map((o) => `${o.method} ${o.path}`);
    expect(implemented.sort()).toEqual(inSpec.sort());
  });
  it("answers 501 with the documented capability_unavailable body", () => {
    const api = norm(
      (spec.components as Json).schemas && ((spec.components as Json).schemas as Json).CapabilityUnavailable,
    );
    expect(diff(norm(z.toJSONSchema(CapabilityUnavailable)), api, "501")).toEqual([]);
  });
});

describe("every /api/v1 route is a registered operation", () => {
  it("has no route handler outside the registry", () => {
    const dir = join(__dirname, "../../app/api/v1");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f === "route.ts") files.push(p);
      }
    };
    walk(dir);
    const registered = new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`));
    const found = files.flatMap((f) => {
      const path =
        "/" +
        relative(dir, f)
          .split(sep)
          .slice(0, -1)
          .map((seg) => seg.replace(/^\[(.+)\]$/, "{$1}"))
          .join("/");
      const methods = [...readFileSync(f, "utf8").matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)].map(
        (m) => m[1],
      );
      return methods.map((m) => `${m} ${path}`);
    });
    expect(found.filter((r) => !registered.has(r))).toEqual([]);
    expect([...registered].filter((r) => !found.includes(r))).toEqual([]);
  });
});

describe("the contract checker catches drift", () => {
  const check = (impl: z.ZodType, api: Json) => diff(norm(z.toJSONSchema(impl)), norm(api), "r");
  const api: Json = {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
      n: { type: "integer" },
      s: { type: "string", enum: ["a", "b"] },
      note: { oneOf: [{ type: "string" }, { type: "null" }] },
    },
  };
  it("accepts a conforming subset", () => {
    expect(check(z.object({ id: z.uuid(), s: z.enum(["a"]), note: z.string().nullable() }), api)).toEqual([]);
  });
  it("flags undocumented fields, wrong types, extra enum values, nulls, formats and missing required fields", () => {
    expect(check(z.object({ id: z.uuid(), extra: z.string() }), api)).toEqual(["r.extra: not in the spec"]);
    expect(check(z.object({ id: z.uuid(), n: z.number() }), api)).toEqual(["r.n: type number ≠ spec integer"]);
    expect(check(z.object({ id: z.uuid(), s: z.enum(["a", "c"]) }), api)).toEqual([
      "r.s: values not in the spec enum: c",
    ]);
    expect(check(z.object({ id: z.uuid(), n: z.number().int().nullable() }), api)).toEqual([
      "r.n: may be null, spec says it can't",
    ]);
    expect(check(z.object({ id: z.string() }), api)).toEqual(["r.id: format none ≠ spec uuid"]);
    expect(check(z.object({ id: z.uuid().optional() }), api)).toEqual(["r.id: required by the spec but optional here"]);
  });
});
