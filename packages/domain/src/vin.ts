/**
 * VIN validation and check digits (ISO 3779 / 49 CFR 565, North America). PRD FL-5: VINs are validated,
 * including the check digit in position 9.
 */
const TRANSLIT: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

function charValue(c: string): number {
  return /\d/.test(c) ? Number(c) : (TRANSLIT[c] ?? Number.NaN);
}

/** The check digit ('0'–'9' or 'X') a VIN should carry in position 9. */
export function vinCheckDigit(vin: string): string {
  const v = vin.toUpperCase();
  if (!VIN_RE.test(v)) throw new RangeError(`Not a 17-character VIN: ${vin}`);
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += charValue(v[i] as string) * (WEIGHTS[i] as number);
  const r = sum % 11;
  return r === 10 ? "X" : String(r);
}

export function isValidVin(vin: string): boolean {
  const v = vin.toUpperCase();
  return VIN_RE.test(v) && v[8] === vinCheckDigit(v);
}

/** Replace position 9 with the correct check digit (used by the simulator to mint valid VINs). */
export function withCheckDigit(vin: string): string {
  const v = vin.toUpperCase();
  const d = vinCheckDigit(v);
  return v.slice(0, 8) + d + v.slice(9);
}
