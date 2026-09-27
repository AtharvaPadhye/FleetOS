import { isValidVin, vinCheckDigit, withCheckDigit } from "./vin";

describe("VIN check digit", () => {
  it("accepts the textbook valid VIN", () => expect(isValidVin("1M8GDM9AXKP042788")).toBe(true));
  it("computes X as the check digit when the remainder is 10", () =>
    expect(vinCheckDigit("1M8GDM9AXKP042788")).toBe("X"));
  it("rejects a wrong check digit", () => expect(isValidVin("1M8GDM9A1KP042788")).toBe(false));
  it("rejects I, O and Q, and wrong lengths", () => {
    expect(isValidVin("1M8GDM9AXKP04278O")).toBe(false);
    expect(isValidVin("1M8GDM9AXKP04278")).toBe(false);
  });
  it("is case-insensitive", () => expect(isValidVin("1m8gdm9axkp042788")).toBe(true));
  it("repairs a VIN's check digit", () => {
    const fixed = withCheckDigit("7G2CEHED0RA004047");
    expect(isValidVin(fixed)).toBe(true);
    expect(fixed.slice(0, 8)).toBe("7G2CEHED");
  });
  it("throws on malformed input", () => expect(() => vinCheckDigit("short")).toThrow(RangeError));
});
