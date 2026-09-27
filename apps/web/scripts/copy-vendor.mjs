#!/usr/bin/env node
// Copies MapLibre's web-worker files into public/vendor so the map can load its worker from a stable URL
// (Turbopack doesn't resolve the library's `new URL(..., import.meta.url)` worker). Generated, git-ignored.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const out = join(here, "..", "public", "vendor", "maplibre", version);
mkdirSync(out, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
  copyFileSync(join(pkgDir, "dist", f), join(out, f));
console.log(`maplibre-gl ${version} worker → public/vendor/maplibre/${version}/`);
