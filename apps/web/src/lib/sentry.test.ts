import type { ErrorEvent } from "@sentry/nextjs";
import { scrubEvent, scrubUrl } from "./sentry";

describe("scrubUrl", () => {
  it("hides share and invite tokens in paths", () => {
    expect(scrubUrl("https://x.app/r/abc123def")).toBe("https://x.app/r/[token]");
    expect(scrubUrl("/invite/tok_9?next=/")).toBe("/invite/[token]?next=/");
  });
  it("hides auth codes and tokens in query strings, keeping other params", () => {
    expect(scrubUrl("/auth/callback?code=secret&next=%2Ffleet")).toBe("/auth/callback?code=[redacted]&next=%2Ffleet");
    expect(scrubUrl("/x?a=1&access_token=t")).toBe("/x?a=1&access_token=[redacted]");
  });
  it("leaves ordinary URLs alone", () => {
    expect(scrubUrl("/fleet/CC-001?status=charging")).toBe("/fleet/CC-001?status=charging");
  });
});

describe("scrubEvent", () => {
  it("drops cookies, headers, bodies and the user, and scrubs URLs", () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: "https://x.app/r/tok",
        cookies: { sb: "session" },
        headers: { authorization: "Bearer t" },
        query_string: "code=c",
        data: { email: "a@b.c" },
      },
      user: { email: "a@b.c" },
      breadcrumbs: [{ data: { url: "/invite/tok", from: "/r/abc", to: "/fleet" } }],
    } as ErrorEvent);
    expect(event.request).toEqual({ url: "https://x.app/r/[token]" });
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "/invite/[token]", from: "/r/[token]", to: "/fleet" });
  });
});
