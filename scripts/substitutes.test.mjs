import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkers } from "./substitutes.mjs";

const good = [
  "// SUBSTITUTE(charger_telemetry, inferred): occupancy from vehicle charge state.",
  "//   Real source: OCPP StatusNotification from depot chargers.",
  "//   Replace by: ingest OCPP connector status.",
  "//   Docs: docs/requirements/data-sources.md §5",
  "export const x = 1;",
].join("\n");

test("parses a well-formed TypeScript marker", () => {
  const { markers, errors } = parseMarkers(good, "a.ts");
  assert.deepEqual(errors, []);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].capability, "charger_telemetry");
  assert.equal(markers[0].kind, "inferred");
  assert.match(markers[0].realSource, /OCPP/);
});

test("accepts SQL and YAML comment styles", () => {
  const sql = good.replaceAll("//", "--");
  const yml = good.replaceAll("//", "#");
  assert.deepEqual(parseMarkers(sql).errors, []);
  assert.deepEqual(parseMarkers(yml).errors, []);
});

test("rejects unknown capability and kind", () => {
  const { errors } = parseMarkers(good.replace("charger_telemetry, inferred", "robots, guessed"));
  assert.equal(errors.length, 2);
});

test("rejects a marker missing its Real source / Replace by / Docs lines", () => {
  const { errors } = parseMarkers("// SUBSTITUTE(rides, simulated): fake trips\nconst y = 2;");
  assert.equal(errors.length, 3);
});
