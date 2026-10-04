import { describe, expect, it, vi } from "vitest";
import { createRouterAdmin, RouterAdminError } from "./router-admin";

type Reply = { status: number; body?: unknown; cookie?: string };

function stub(replies: Record<string, Reply[]>) {
  const calls: Array<{ method: string; path: string; cookie: string | null }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, path: u.pathname, cookie: headers.get("cookie") });
    const queue = replies[`${method} ${u.pathname}`] ?? [];
    const reply = queue.shift() ?? { status: 500 };
    const resHeaders = new Headers({ "content-type": "application/json" });
    if (reply.cookie) resHeaders.append("set-cookie", `auth_token=${reply.cookie}; Path=/; HttpOnly`);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: resHeaders });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const login = (cookie: string): Reply => ({ status: 200, body: { success: true }, cookie });
const created = (): Reply => ({ status: 201, body: { id: "rk1", key: "sk-9r-abcd", name: "n", machineId: "m" } });

describe("router admin", () => {
  it("logs in once and reuses the cookie across calls", async () => {
    const { fetchImpl, calls } = stub({ "POST /api/auth/login": [login("c1")], "POST /api/keys": [created(), created()] });
    const admin = createRouterAdmin({ baseUrl: "http://nine-router:20128", password: "pw", fetch: fetchImpl });
    expect(await admin.createKey("ana@corp.io laptop")).toEqual({ id: "rk1", key: "sk-9r-abcd" });
    await admin.createKey("ana@corp.io ci");
    expect(calls.filter((c) => c.path === "/api/auth/login")).toHaveLength(1);
    expect(calls.filter((c) => c.path === "/api/keys").every((c) => c.cookie === "auth_token=c1")).toBe(true);
  });

  it("re-logs in exactly once on a 401 and retries once", async () => {
    const { fetchImpl, calls } = stub({
      "POST /api/auth/login": [login("c1"), login("c2")],
      "POST /api/keys": [{ status: 401 }, created()],
    });
    const admin = createRouterAdmin({ baseUrl: "http://r", password: "pw", fetch: fetchImpl });
    await expect(admin.createKey("n")).resolves.toEqual({ id: "rk1", key: "sk-9r-abcd" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/auth/login", "POST /api/keys", "POST /api/auth/login", "POST /api/keys",
    ]);
    expect(calls[3].cookie).toBe("auth_token=c2");
  });

  it("gives up after a second 401 instead of looping", async () => {
    const { fetchImpl, calls } = stub({
      "POST /api/auth/login": [login("c1"), login("c2"), login("c3")],
      "POST /api/keys": [{ status: 401 }, { status: 401 }],
    });
    const admin = createRouterAdmin({ baseUrl: "http://r", password: "pw", fetch: fetchImpl });
    await expect(admin.createKey("n")).rejects.toBeInstanceOf(RouterAdminError);
    expect(calls.filter((c) => c.path === "/api/auth/login")).toHaveLength(2);
  });

  it("does not retry a failed login and refuses to log in again for 60 seconds", async () => {
    let clock = 1_000_000;
    const { fetchImpl, calls } = stub({ "POST /api/auth/login": [{ status: 401 }, login("c1")], "POST /api/keys": [created()] });
    const admin = createRouterAdmin({ baseUrl: "http://r", password: "wrong", fetch: fetchImpl, now: () => clock });
    await expect(admin.createKey("n")).rejects.toThrow(/login/i);
    await expect(admin.createKey("n")).rejects.toThrow(/login/i);
    expect(calls).toHaveLength(1);
    clock += 60_001;
    await expect(admin.createKey("n")).resolves.toMatchObject({ id: "rk1" });
  });

  it("shares one login between concurrent calls", async () => {
    const { fetchImpl, calls } = stub({
      "POST /api/auth/login": [login("c1"), login("c2")],
      "POST /api/keys": [created(), created()],
    });
    const admin = createRouterAdmin({ baseUrl: "http://r", password: "pw", fetch: fetchImpl });
    await Promise.all([admin.createKey("a"), admin.createKey("b")]);
    expect(calls.filter((c) => c.path === "/api/auth/login")).toHaveLength(1);
  });

  it("treats deleting an already-missing key as done", async () => {
    const { fetchImpl } = stub({ "POST /api/auth/login": [login("c1")], "DELETE /api/keys/rk1": [{ status: 404 }] });
    const admin = createRouterAdmin({ baseUrl: "http://r", password: "pw", fetch: fetchImpl });
    await expect(admin.deleteKey("rk1")).resolves.toBeUndefined();
  });

  it("rejects a create response without a key", async () => {
    const { fetchImpl } = stub({ "POST /api/auth/login": [login("c1")], "POST /api/keys": [{ status: 201, body: { id: "x" } }] });
    const admin = createRouterAdmin({ baseUrl: "http://r", password: "pw", fetch: fetchImpl });
    await expect(admin.createKey("n")).rejects.toBeInstanceOf(RouterAdminError);
  });

  it("wraps a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const admin = createRouterAdmin({ baseUrl: "http://r", password: "pw", fetch: fetchImpl });
    await expect(admin.createKey("n")).rejects.toBeInstanceOf(RouterAdminError);
  });
});
