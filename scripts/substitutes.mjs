#!/usr/bin/env node
// Inventory and validate SUBSTITUTE(<capability>, <kind>) markers (CLAUDE.md, ADR-0012).
// Usage: node scripts/substitutes.mjs [--json]   → exits 1 if any marker is malformed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Copy of the capability registry in packages/domain/src/capabilities.ts (source of truth);
// packages/domain/src/capabilities.test.ts fails if the two drift. Kept here so this script needs no build step.
export const CAPABILITIES = [
  "tesla",
  "rides",
  "earnings",
  "cabin_events",
  "autonomy_events",
  "dispatch",
  "charger_telemetry",
  "live_tariffs",
  "vendor_tracking",
];
export const KINDS = ["simulated", "csv", "manual", "inferred", "static", "fixture"];

const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|sql|ya?ml|sh)$/;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "out",
  "prototype",
  "docs",
  "test-results",
  "playwright-report",
]);
const SELF = fileURLToPath(import.meta.url);
const COMMENT = String.raw`(?:\/\/|--|#)`;
const HEAD = new RegExp(String.raw`^\s*${COMMENT}\s*SUBSTITUTE\(([^)]*)\)\s*:\s*(.*)$`);
const FIELD = (name) => new RegExp(String.raw`^\s*${COMMENT}\s+${name}:\s*(\S.*)$`);
const FIELDS = [
  ["realSource", "Real source"],
  ["replaceBy", "Replace by"],
  ["docs", "Docs"],
];

/** Parse markers in one file's text. Returns { markers, errors }. */
export function parseMarkers(text, file = "<text>") {
  const lines = text.split(/\r?\n/);
  const markers = [];
  const errors = [];
  lines.forEach((line, i) => {
    const m = line.match(HEAD);
    if (!m) return;
    const where = `${file}:${i + 1}`;
    const [capability = "", kind = ""] = m[1].split(",").map((s) => s.trim());
    const marker = { file, line: i + 1, capability, kind, summary: m[2].trim() };
    if (!CAPABILITIES.includes(capability))
      errors.push(`${where} unknown capability "${capability}" (allowed: ${CAPABILITIES.join(", ")})`);
    if (!KINDS.includes(kind)) errors.push(`${where} unknown kind "${kind}" (allowed: ${KINDS.join(", ")})`);
    if (!marker.summary) errors.push(`${where} missing one-line summary after "SUBSTITUTE(...):"`);
    FIELDS.forEach(([key, label], k) => {
      const fm = (lines[i + 1 + k] ?? "").match(FIELD(label));
      if (fm) marker[key] = fm[1].trim();
      else errors.push(`${where} line ${k + 2} must be "${label}: …"`);
    });
    markers.push(marker);
  });
  return { markers, errors };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SCAN_EXT.test(name) && p !== SELF && !/\.test\.m?[jt]sx?$/.test(name)) out.push(p);
  }
  return out;
}

function main() {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const all = { markers: [], errors: [] };
  for (const f of walk(root)) {
    const { markers, errors } = parseMarkers(readFileSync(f, "utf8"), relative(root, f));
    all.markers.push(...markers);
    all.errors.push(...errors);
  }
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(all, null, 2));
  } else {
    console.log(`SUBSTITUTE markers: ${all.markers.length}`);
    for (const m of all.markers)
      console.log(`  ${m.capability.padEnd(18)} ${m.kind.padEnd(9)} ${m.file}:${m.line}  ${m.summary}`);
    if (all.errors.length) console.error(`\nMalformed markers (${all.errors.length}):\n  ${all.errors.join("\n  ")}`);
  }
  process.exit(all.errors.length ? 1 : 0);
}

if (process.argv[1] === SELF) main();
