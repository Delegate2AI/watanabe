import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The boot contract (spec 16): `portal.yaml` is loaded FIRST, and a bad file is
 * fatal. Everything else in `register()` is written to never throw, precisely so
 * a flaky dependency cannot flap a pod. Configuration is not a flaky dependency:
 * a pod serving the wrong auth mode is worse than a pod that does not start.
 */

const refreshRepo = vi.fn(async () => {});
const ensureFullHistoryForWrite = vi.fn(async () => {});

vi.mock("@/lib/repo", () => ({
  refreshRepo,
  ensureFullHistoryForWrite,
  repoRoot: () => "/tmp/repo",
  vaultRoot: () => "/tmp/repo/docs",
}));

let dir: string;

beforeEach(() => {
  vi.resetModules();
  refreshRepo.mockClear();
  ensureFullHistoryForWrite.mockClear();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  dir = mkdtempSync(path.join(tmpdir(), "portal-boot-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const writeConfig = (body: string) => {
  const p = path.join(dir, "portal.yaml");
  writeFileSync(p, body);
  vi.stubEnv("PORTAL_CONFIG", p);
  return p;
};

describe("register() — config is loaded first and fatally", () => {
  it("throws on a malformed portal.yaml", async () => {
    writeConfig("app:\n  name: [unclosed\n");
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow(/portal\.yaml/);
  });

  // The ordering assertion: a bad config must abort BEFORE any side effect runs.
  it("does not clone or refresh the repo when the config is invalid", async () => {
    writeConfig("auth:\n  mode: bogus\n");
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow();
    expect(refreshRepo).not.toHaveBeenCalled();
    expect(ensureFullHistoryForWrite).not.toHaveBeenCalled();
  });

  it("refuses to boot with auth.mode: none and no PORTAL_ALLOW_NO_AUTH", async () => {
    writeConfig("auth:\n  mode: none\n  none:\n    email: dev@example.com\n");
    const { register } = await import("./instrumentation");
    await expect(register()).rejects.toThrow(/PORTAL_ALLOW_NO_AUTH/);
    expect(refreshRepo).not.toHaveBeenCalled();
  });

  it("boots with auth.mode: none when PORTAL_ALLOW_NO_AUTH=1", async () => {
    writeConfig("auth:\n  mode: none\n  none:\n    email: dev@example.com\n");
    vi.stubEnv("PORTAL_ALLOW_NO_AUTH", "1");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(refreshRepo).toHaveBeenCalledTimes(1);
  });

  it("shouts about disabled authentication on the way up", async () => {
    writeConfig("auth:\n  mode: none\n  none:\n    email: dev@example.com\n");
    vi.stubEnv("PORTAL_ALLOW_NO_AUTH", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("AUTHENTICATION IS DISABLED"))).toBe(true);
  });

  it("boots normally with no portal.yaml at all", async () => {
    vi.stubEnv("PORTAL_CONFIG", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(refreshRepo).toHaveBeenCalledTimes(1);
  });

  it("is a no-op outside the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    writeConfig("auth:\n  mode: bogus\n");
    const { register } = await import("./instrumentation");
    await expect(register()).resolves.toBeUndefined();
    expect(refreshRepo).not.toHaveBeenCalled();
  });
});

describe("error reporting", () => {
  const captureServerException = vi.fn();

  beforeEach(() => {
    captureServerException.mockClear();
    vi.doMock("@/lib/analytics/server", () => ({ captureServerException }));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/analytics/server");
  });

  it("routes every log.error to PostHog once the server has booted", async () => {
    vi.stubEnv("PORTAL_CONFIG", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();
    const { log } = await import("@/lib/log");
    log.error("db write failed", { op: "recordThread" });
    expect(captureServerException).toHaveBeenCalledWith(
      "db write failed",
      expect.objectContaining({ properties: expect.objectContaining({ op: "recordThread", source: "log" }) }),
    );
  });

  it("attributes a failure to the hashed person the log names, never the address", async () => {
    vi.stubEnv("PORTAL_CONFIG", "");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { register } = await import("./instrumentation");
    await register();
    const { log } = await import("@/lib/log");
    const { analyticsIdFor } = await import("@/lib/analytics/config");
    log.error("shared-docs request failed", { owner: "alice@example.com" });
    expect(captureServerException).toHaveBeenCalledWith(
      "shared-docs request failed",
      expect.objectContaining({ distinctId: analyticsIdFor("alice@example.com") }),
    );
  });

  it("reports an uncaught request error with the route that raised it", async () => {
    const { onRequestError } = await import("./instrumentation");
    const error = new Error("boom");
    await onRequestError(
      error,
      { path: "/api/docs", method: "POST", headers: {} },
      { routerKind: "App Router", routePath: "/api/docs", routeType: "route" },
    );
    expect(captureServerException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        properties: expect.objectContaining({ path: "/api/docs", method: "POST", source: "request" }),
      }),
    );
  });

  it("stays out of the way on the edge runtime, where the reporter cannot load", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { onRequestError } = await import("./instrumentation");
    await onRequestError(
      new Error("boom"),
      { path: "/", method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/", routeType: "render" },
    );
    expect(captureServerException).not.toHaveBeenCalled();
  });
});
