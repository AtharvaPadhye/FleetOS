import {
  NO_VEHICLES_MESSAGE,
  detectMapping,
  parseCsv,
  parseDate,
  parseMoneyCents,
  payoutLedgerLines,
  validatePayoutRows,
  type VehicleRef,
} from "./payouts";

const VEHICLES: VehicleRef[] = [
  { id: "v47", vin: "7G2CEHED9RA004047", number: "047", displayName: "Cybercab 047" },
  { id: "v31", vin: "7G2CEHED5RA004031", number: "031", displayName: "Cybercab 031" },
];

const UBER = [
  "﻿Date,Vehicle plate number,Trips,Online hours,Gross earnings,Service fee,Tips",
  '2026-09-01,047,21,18.5,"$1,194.20",-238.84,12.00',
  "09/01/2026,Cybercab 031,19,17.0,$987.10,($197.42),",
  "2026-09-01,999,3,2,$50.00,-10.00,",
  "2026-13-01,047,1,1,$10.00,,",
  "2026-09-02,047,x,1,oops,,",
].join("\r\n");

describe("parseCsv", () => {
  it("handles BOM, CRLF, quoted commas and escaped quotes", () => {
    const p = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n');
    expect(p.headers).toEqual(["a", "b"]);
    expect(p.rows).toEqual([["x, y", 'say "hi"']]);
  });
  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a\n"line1\nline2"').rows).toEqual([["line1\nline2"]]);
  });
});

describe("parsers", () => {
  it("parses money in statement formats", () => {
    expect(parseMoneyCents("$1,194.20")).toBe(119_420);
    expect(parseMoneyCents("-238.84")).toBe(-23_884);
    expect(parseMoneyCents("($197.42)")).toBe(-19_742);
    expect(parseMoneyCents("12")).toBe(1_200);
    expect(parseMoneyCents("12.5")).toBe(1_250);
    expect(parseMoneyCents("oops")).toBeNull();
    expect(parseMoneyCents("")).toBeNull();
  });
  it("parses ISO and US dates and rejects impossible ones", () => {
    expect(parseDate("2026-09-01")).toBe("2026-09-01");
    expect(parseDate("9/1/2026")).toBe("2026-09-01");
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("yesterday")).toBeNull();
  });
});

describe("detectMapping", () => {
  it("recognises an Uber-Fleet-Portal-style header", () => {
    const d = detectMapping(parseCsv(UBER).headers);
    expect(d.layout).toBe("uber_fleet_portal");
    expect(d.mapping).toMatchObject({
      date: "Date",
      vehicle: "Vehicle plate number",
      gross: "Gross earnings",
      fee: "Service fee",
      tips: "Tips",
      trips: "Trips",
      online_hours: "Online hours",
    });
  });
  it("falls back to custom mapping when required columns are unrecognised", () => {
    const d = detectMapping(["When", "Car", "Money"]);
    expect(d.layout).toBe("custom");
    expect(d.missing).toEqual(["date", "vehicle", "gross"]);
  });
});

describe("validatePayoutRows", () => {
  const parsed = parseCsv(UBER);
  const { mapping } = detectMapping(parsed.headers);
  const v = validatePayoutRows(parsed, mapping, VEHICLES);

  it("accepts good rows, matching vehicles by number or display name", () => {
    expect(v.rowsTotal).toBe(5);
    expect(v.valid.map((r) => [r.row, r.vehicleLabel, r.grossCents, r.feeCents, r.tipsCents])).toEqual([
      [2, "047", 119_420, 23_884, 1_200],
      [3, "031", 98_710, 19_742, 0],
    ]);
  });
  it("reports each problem with its row and column", () => {
    expect(v.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 4, column: "Vehicle plate number", message: expect.stringContaining("999") }),
        expect.objectContaining({ row: 5, column: "Date" }),
        expect.objectContaining({ row: 6, column: "Gross earnings" }),
        expect.objectContaining({ row: 6, column: "Trips" }),
      ]),
    );
  });
  it("explains once when the organization has no vehicles, instead of failing every row", () => {
    const r = validatePayoutRows(parsed, mapping, []);
    expect(r.valid).toHaveLength(0);
    expect(r.errors).toEqual([{ row: 0, column: "Vehicle plate number", message: NO_VEHICLES_MESSAGE }]);
  });
  it("refuses to validate without the required columns mapped", () => {
    const r = validatePayoutRows(parsed, { date: "Date" }, VEHICLES);
    expect(r.valid).toHaveLength(0);
    expect(r.errors.map((e) => e.column)).toEqual(["vehicle", "gross"]);
  });
});

describe("payoutLedgerLines", () => {
  const rows = validatePayoutRows(parseCsv(UBER), detectMapping(parseCsv(UBER).headers).mapping, VEHICLES).valid;
  const lines = payoutLedgerLines(rows);
  it("books gross (+ tips) as revenue and the fee as a platform fee", () => {
    expect(lines).toContainEqual({
      vehicleId: "v47",
      occurredOn: "2026-09-01",
      category: "gross_ride_revenue",
      amountCents: 120_620,
      sourceRef: "2026-09-01|v47|gross",
    });
    expect(lines).toContainEqual({
      vehicleId: "v47",
      occurredOn: "2026-09-01",
      category: "platform_fee",
      amountCents: 23_884,
      sourceRef: "2026-09-01|v47|fee",
    });
  });
  it("produces the same refs for the same statement (idempotent re-import)", () => {
    expect(payoutLedgerLines(rows).map((l) => l.sourceRef)).toEqual(lines.map((l) => l.sourceRef));
  });
});
