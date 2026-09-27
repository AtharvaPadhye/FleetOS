import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports ok and is not cached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { status: string; service: string };
    expect(body).toMatchObject({ status: "ok", service: "fleetos-web" });
  });
});
