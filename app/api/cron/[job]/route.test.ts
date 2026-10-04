import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dispatchMock = vi.fn();
vi.mock("@/lib/jobs/dispatch", () => ({
  dispatch: (job: string) => dispatchMock(job),
}));

const { POST } = await import("./route");

function post(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set("x-cron-secret", secret);
  return new Request("http://localhost/api/cron/repo-refresh", { method: "POST", headers });
}

function context(job = "repo-refresh") {
  return { params: Promise.resolve({ job }) };
}

beforeEach(() => {
  process.env.CRON_SECRET = "expected-secret";
  dispatchMock.mockReset();
});

afterEach(() => delete process.env.CRON_SECRET);

describe("POST /api/cron/[job]", () => {
  it("returns 401 when the cron secret is absent", async () => {
    const response = await POST(post(), context());
    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toBe("");
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the cron secret is wrong", async () => {
    const response = await POST(post("wrong"), context());
    expect(response.status).toBe(401);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("returns 202 for an enqueued job", async () => {
    dispatchMock.mockReturnValue({ status: "enqueued" });
    const response = await POST(post("expected-secret"), context());
    expect(response.status).toBe(202);
    expect(dispatchMock).toHaveBeenCalledWith("repo-refresh");
  });

  it("returns 202 for an overlapping no-op", async () => {
    dispatchMock.mockReturnValue({ status: "noop" });
    const response = await POST(post("expected-secret"), context());
    expect(response.status).toBe(202);
  });

  it("returns 204 for a disabled job", async () => {
    dispatchMock.mockReturnValue({ status: "disabled" });
    const response = await POST(post("expected-secret"), context("meetings-poll"));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("returns 404 for an unknown job", async () => {
    dispatchMock.mockReturnValue({ status: "unknown" });
    const response = await POST(post("expected-secret"), context("missing"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "not_found" } });
  });

  it("returns 500 when dispatch throws (DB fault) instead of crashing the route", async () => {
    dispatchMock.mockImplementation(() => {
      throw new Error("database is locked");
    });
    const response = await POST(post("expected-secret"), context());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: { code: "internal" } });
  });
});
