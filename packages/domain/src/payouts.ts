/**
 * Payout-statement CSV import (roadmap task 3.6, PRD FN-6, flows.md F4): parse → detect layout → map columns
 * → validate rows → ledger lines. Pure; the upload/commit actions live in apps/web.
 *
 * The "uber_fleet_portal" layout is modelled on Uber Fleet Portal vehicle-earnings exports as described in
 * public help pages (docs/research/2026-09-26-tesla-and-data-sources.md D8). Exact header names are an
 * ASSUMPTION until a real export is checked; detection uses synonyms and anything unrecognised falls back to
 * manual column mapping.
 */
import type { LedgerCategory } from "./money";

export const PAYOUT_FIELDS = ["date", "vehicle", "gross", "fee", "tips", "trips", "online_hours"] as const;
export type PayoutField = (typeof PAYOUT_FIELDS)[number];
export const REQUIRED_PAYOUT_FIELDS: readonly PayoutField[] = ["date", "vehicle", "gross"];

export type ColumnMapping = Partial<Record<PayoutField, string>>;
export type PayoutLayout = "uber_fleet_portal" | "custom";

/** Header synonyms (lower-cased, punctuation-insensitive). */
const SYNONYMS: Record<PayoutField, string[]> = {
  date: ["date", "trip date", "day", "period start", "earnings date", "statement date"],
  vehicle: [
    "vehicle",
    "vehicle vin",
    "vin",
    "vehicle plate number",
    "plate",
    "license plate",
    "vehicle number",
    "vehicle id",
    "vehicle name",
  ],
  gross: ["gross earnings", "total earnings", "gross fare", "fare", "fares", "gross", "total fare", "revenue"],
  fee: ["service fee", "platform fee", "uber fee", "commission", "fees"],
  tips: ["tips", "tip"],
  trips: ["trips", "trip count", "completed trips", "rides"],
  online_hours: ["online hours", "hours online", "online time (hours)"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** RFC 4180 CSV: quoted fields, escaped quotes, commas/newlines inside quotes, CRLF, UTF-8 BOM. */
export function parseCsv(text: string): ParsedCsv {
  const src = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((f) => f.trim() !== "")) records.push(record);
      record = [];
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f.trim() !== "")) records.push(record);
  const [headers = [], ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Map headers to fields by synonym. `layout` is uber_fleet_portal only when every required field matched. */
export function detectMapping(headers: readonly string[]): {
  layout: PayoutLayout;
  mapping: ColumnMapping;
  missing: PayoutField[];
} {
  const mapping: ColumnMapping = {};
  for (const field of PAYOUT_FIELDS) {
    const hit = headers.find((h) => SYNONYMS[field].includes(norm(h)));
    if (hit) mapping[field] = hit;
  }
  const missing = REQUIRED_PAYOUT_FIELDS.filter((f) => !mapping[f]);
  return { layout: missing.length === 0 ? "uber_fleet_portal" : "custom", mapping, missing };
}

/** "$1,234.56", "1234.56", "(12.00)", "-12.00" → integer cents (negative when parenthesised or signed). */
export function parseMoneyCents(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const cleaned = s.replace(/[()$,\s]/g, "").replace(/^-/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole = "0", frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** Accepts YYYY-MM-DD, M/D/YYYY and MM/DD/YYYY (US exports). Returns YYYY-MM-DD or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number;
  let m: number;
  let d: number;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [y, m, d] = [Number(us[3]), Number(us[1]), Number(us[2])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export interface VehicleRef {
  id: string;
  vin: string;
  number: string;
  displayName: string | null;
}

export interface RowError {
  row: number;
  column: string;
  message: string;
}

export interface PayoutRow {
  row: number;
  date: string;
  vehicleId: string;
  vehicleLabel: string;
  grossCents: number;
  feeCents: number;
  tipsCents: number;
  trips: number | null;
  onlineHours: number | null;
}

export const NO_VEHICLES_MESSAGE =
  "This organization has no vehicles yet, so no row can be matched. Add vehicles (or connect Tesla) first, or try the file in a demo organization.";

export interface PayoutValidation {
  rowsTotal: number;
  valid: PayoutRow[];
  errors: RowError[];
}

/** Validate every row against the mapping and the org's vehicles (matched by VIN, number or display name). */
export function validatePayoutRows(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  vehicles: readonly VehicleRef[],
): PayoutValidation {
  const idx = (f: PayoutField) => (mapping[f] ? parsed.headers.indexOf(mapping[f] as string) : -1);
  const col: Record<PayoutField, number> = Object.fromEntries(PAYOUT_FIELDS.map((f) => [f, idx(f)])) as Record<
    PayoutField,
    number
  >;
  const errors: RowError[] = [];
  for (const f of REQUIRED_PAYOUT_FIELDS) {
    if (col[f] < 0) errors.push({ row: 0, column: f, message: `Map a column to "${f}".` });
  }
  if (errors.length) return { rowsTotal: parsed.rows.length, valid: [], errors };
  if (vehicles.length === 0) {
    // One clear message instead of a "no vehicle matches" error on every row.
    return {
      rowsTotal: parsed.rows.length,
      valid: [],
      errors: [{ row: 0, column: mapping.vehicle as string, message: NO_VEHICLES_MESSAGE }],
    };
  }

  const byKey = new Map<string, VehicleRef>();
  for (const v of vehicles) {
    byKey.set(v.vin.toUpperCase(), v);
    byKey.set(v.number.toUpperCase(), v);
    if (v.displayName) byKey.set(v.displayName.toUpperCase(), v);
  }

  const valid: PayoutRow[] = [];
  parsed.rows.forEach((cells, i) => {
    const row = i + 2; // 1-based, after the header row
    const get = (f: PayoutField) => (col[f] >= 0 ? (cells[col[f]] ?? "").trim() : "");
    const rowErrors: RowError[] = [];

    const date = parseDate(get("date"));
    if (!date)
      rowErrors.push({
        row,
        column: mapping.date as string,
        message: `"${get("date")}" is not a date (use YYYY-MM-DD or MM/DD/YYYY).`,
      });

    const vehicleKey = get("vehicle");
    const vehicle = byKey.get(vehicleKey.toUpperCase());
    if (!vehicle)
      rowErrors.push({
        row,
        column: mapping.vehicle as string,
        message: `No vehicle matches "${vehicleKey}" (use VIN, number or name).`,
      });

    const gross = parseMoneyCents(get("gross"));
    if (gross === null || gross < 0)
      rowErrors.push({ row, column: mapping.gross as string, message: `"${get("gross")}" is not a valid amount.` });

    const feeRaw = get("fee");
    const fee = feeRaw ? parseMoneyCents(feeRaw) : 0;
    if (fee === null)
      rowErrors.push({ row, column: mapping.fee as string, message: `"${feeRaw}" is not a valid amount.` });

    const tipsRaw = get("tips");
    const tips = tipsRaw ? parseMoneyCents(tipsRaw) : 0;
    if (tips === null || (tips ?? 0) < 0)
      rowErrors.push({ row, column: mapping.tips as string, message: `"${tipsRaw}" is not a valid amount.` });

    const tripsRaw = get("trips");
    const trips = tripsRaw ? Number(tripsRaw) : null;
    if (trips !== null && (!Number.isInteger(trips) || trips < 0))
      rowErrors.push({
        row,
        column: mapping.trips as string,
        message: `"${tripsRaw}" is not a whole number of trips.`,
      });

    const hoursRaw = get("online_hours");
    const onlineHours = hoursRaw ? Number(hoursRaw) : null;
    if (onlineHours !== null && (!Number.isFinite(onlineHours) || onlineHours < 0))
      rowErrors.push({
        row,
        column: mapping.online_hours as string,
        message: `"${hoursRaw}" is not a number of hours.`,
      });

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    valid.push({
      row,
      date: date as string,
      vehicleId: (vehicle as VehicleRef).id,
      vehicleLabel: (vehicle as VehicleRef).number,
      grossCents: gross as number,
      // Statements often show fees as negatives; the ledger stores positive amounts.
      feeCents: Math.abs(fee as number),
      tipsCents: tips as number,
      trips,
      onlineHours,
    });
  });
  return { rowsTotal: parsed.rows.length, valid, errors };
}

export interface PayoutLedgerLine {
  vehicleId: string;
  occurredOn: string;
  category: LedgerCategory;
  amountCents: number;
  /** Deterministic: re-importing the same statement adds nothing (flows.md F4). */
  sourceRef: string;
}

export function payoutLedgerLines(rows: readonly PayoutRow[]): PayoutLedgerLine[] {
  const out: PayoutLedgerLine[] = [];
  for (const r of rows) {
    const ref = `${r.date}|${r.vehicleId}`;
    out.push({
      vehicleId: r.vehicleId,
      occurredOn: r.date,
      category: "gross_ride_revenue",
      amountCents: r.grossCents + r.tipsCents,
      sourceRef: `${ref}|gross`,
    });
    if (r.feeCents > 0)
      out.push({
        vehicleId: r.vehicleId,
        occurredOn: r.date,
        category: "platform_fee",
        amountCents: r.feeCents,
        sourceRef: `${ref}|fee`,
      });
  }
  return out;
}
