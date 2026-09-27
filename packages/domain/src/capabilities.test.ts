import { CAPABILITIES, SUBSTITUTE_KINDS } from "./capabilities";
// @ts-expect-error — plain .mjs repo script without type declarations
import { CAPABILITIES as SCRIPT_CAPS, KINDS as SCRIPT_KINDS } from "../../../scripts/substitutes.mjs";

describe("capability registry", () => {
  it("matches the SUBSTITUTE marker checker's copy", () => {
    expect([...CAPABILITIES]).toEqual(SCRIPT_CAPS);
    expect([...SUBSTITUTE_KINDS]).toEqual(SCRIPT_KINDS);
  });
});
