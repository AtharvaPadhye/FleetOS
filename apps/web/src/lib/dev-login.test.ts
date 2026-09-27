import { describe, expect, it } from "vitest";
import { devAutoLoginEmail, safeNext } from "./dev-login";

describe("devAutoLoginEmail", () => {
  it("is on only under next dev with a valid email", () => {
    expect(devAutoLoginEmail({ NODE_ENV: "development", DEV_AUTO_LOGIN_EMAIL: " Akshat1198@Gmail.com " })).toBe(
      "akshat1198@gmail.com",
    );
    expect(devAutoLoginEmail({ NODE_ENV: "production", DEV_AUTO_LOGIN_EMAIL: "a@b.co" })).toBeNull();
    expect(devAutoLoginEmail({ NODE_ENV: "test", DEV_AUTO_LOGIN_EMAIL: "a@b.co" })).toBeNull();
    expect(devAutoLoginEmail({ NODE_ENV: "development" })).toBeNull();
    expect(devAutoLoginEmail({ NODE_ENV: "development", DEV_AUTO_LOGIN_EMAIL: "not-an-email" })).toBeNull();
  });
});

describe("safeNext", () => {
  it("keeps same-origin paths and rejects everything else", () => {
    expect(safeNext("/financials?x=1")).toBe("/financials?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("/auth/dev-login")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
