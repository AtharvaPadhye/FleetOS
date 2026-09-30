import { formatLog, log } from "./log";

const at = new Date("2026-09-30T12:00:00Z");

describe("formatLog", () => {
  it("writes one JSON object with time, level, event and fields", () => {
    const line = formatLog("info", "tick.done", { request_id: "r1", org_id: "o1", orgs: 3 }, at);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      ts: "2026-09-30T12:00:00.000Z",
      level: "info",
      event: "tick.done",
      request_id: "r1",
      org_id: "o1",
      orgs: 3,
    });
  });

  it("redacts secret-looking keys, nested too", () => {
    const parsed = JSON.parse(
      formatLog("warn", "x", { token: "t", headers: { Authorization: "Bearer b", cookie: "c" }, email: "a@b.c" }, at),
    );
    expect(parsed.token).toBe("[redacted]");
    expect(parsed.headers).toEqual({ Authorization: "[redacted]", cookie: "[redacted]" });
    expect(parsed.email).toBe("[redacted]");
    expect(JSON.stringify(parsed)).not.toMatch(/Bearer b|a@b\.c/);
  });

  it("serialises errors with name, message and stack", () => {
    const parsed = JSON.parse(formatLog("error", "x", { err: new TypeError("boom") }, at));
    expect(parsed.err).toMatchObject({ name: "TypeError", message: "boom" });
    expect(parsed.err.stack).toContain("boom");
  });
});

describe("log", () => {
  it("sends errors to stderr and info to stdout", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log.error("e");
    log.info("i");
    expect(JSON.parse(String(err.mock.calls[0]?.[0])).event).toBe("e");
    expect(JSON.parse(String(out.mock.calls[0]?.[0])).event).toBe("i");
    err.mockRestore();
    out.mockRestore();
  });
});
