import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_RULES } from "@fleetos/domain";

/** The migration seeds system rules from its own JSON copy; it must match packages/domain SYSTEM_RULES. */
describe("system exception rules", () => {
  it("are the same in the seed migration and in the domain package", () => {
    const sql = readFileSync(
      join(__dirname, "../../../../../supabase/migrations/20260927000016_exceptions.sql"),
      "utf8",
    );
    const json = sql.slice(sql.indexOf("$json$") + 6, sql.lastIndexOf("$json$"));
    expect(JSON.parse(json)).toEqual(SYSTEM_RULES.map((r) => ({ ...r, capability: r.capability ?? null })));
  });
});
