import { describe, expect, it, vi } from "vitest";
import { createPortalClient } from "./portal.mjs";
import { GateState, hashKey } from "./state.mjs";
import { createSync } from "./sync.mjs";

const SNAP = {
  generatedAt: "2026-10-04T12:00:00.000Z",
  keys: [{ id: "k1", hash: hashKey("sk"), ownerEmail: "ana@corp.io" }],
  groups: [{ slug: "local", models: ["ollama/*"] }],
  budgets: [{
    ownerEmail: "ana@corp.io", groupSlug: "local", allowed: true, tokens: 100, period: "day",
    periodStart: "2026-10-04", resetAt: "2026-10-05T00:00:00.000Z", used: 0, bonus: 0,
  }],
};

function portalFetch(handlers) {
  const calls = [];
  const impl = vi.fn(async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const next = handlers[path]?.shift();
    if (next instanceof Error) throw next;
    return new Response(next?.body === undefined ? null : JSON.stringify(next.body), { status: next?.status ?? 500 });
  });
  return { impl, calls };
}

function spend(state, now) {
  const check = state.check(hashKey("sk"), "ollama/q", now);
  state.record({ check, model: "ollama/q", usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 }, now });
}

describe("portal client", () => {
  it("sends the secret and reads a snapshot, a disabled flag, or an error", async () => {
    const { impl, calls } = portalFetch({
      "/api/internal/llm/snapshot": [{ status: 200, body: SNAP }, { status: 404 }, { status: 500 }],
    });
    const portal = createPortalClient({ portalUrl: "http://portal:3100/", secret: "s3cret", fetchImpl: impl });
    expect(await portal.pullSnapshot()).toEqual({ status: "ok", snapshot: SNAP });
    expect(await portal.pullSnapshot()).toEqual({ status: "disabled" });
    expect((await portal.pullSnapshot()).status).toBe("error");
    expect(new Headers(calls[0].init.headers).get("x-llm-gate-secret")).toBe("s3cret");
  });

  it("tells a permanent rejection (400, 413) from a retryable failure", async () => {
    const { impl } = portalFetch({
      "/api/internal/llm/usage": [{ status: 200, body: { ok: true } }, { status: 400 }, { status: 413 }, { status: 401 }, { status: 503 }, new TypeError("fetch failed")],
    });
    const portal = createPortalClient({ portalUrl: "http://p", secret: "s", fetchImpl: impl });
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await portal.pushBatch({ batchId: "b", deltas: [] }));
    expect(results).toEqual(["ok", "drop", "drop", "retry", "retry", "retry"]);
  });
});

describe("sync", () => {
  it("applies a pulled snapshot and marks the gate disabled on 404", async () => {
    const state = new GateState();
    const { impl } = portalFetch({ "/api/internal/llm/snapshot": [{ status: 200, body: SNAP }, { status: 404 }] });
    const sync = createSync({ state, portal: createPortalClient({ portalUrl: "http://p", secret: "s", fetchImpl: impl }), now: () => 1000, log: {} });
    await sync.pull();
    expect(state.usable(1000)).toBe(true);
    await sync.pull();
    expect(state.usable(1000)).toBe(false);
  });

  it("retries a failed push with the same batch id and new usage waits its turn", async () => {
    const state = new GateState();
    state.applySnapshot(SNAP, 0);
    const { impl, calls } = portalFetch({
      "/api/internal/llm/usage": [new TypeError("fetch failed"), { status: 200, body: { ok: true } }, { status: 200, body: { ok: true } }],
    });
    const sync = createSync({ state, portal: createPortalClient({ portalUrl: "http://p", secret: "s", fetchImpl: impl }), now: () => 1000, log: {} });
    spend(state, 1000);
    await sync.flush();
    spend(state, 1000);
    await sync.flush();
    await sync.flush();
    const bodies = calls.map((c) => JSON.parse(c.init.body));
    expect(bodies).toHaveLength(3);
    expect(bodies[1].batchId).toBe(bodies[0].batchId);
    expect(bodies[2].batchId).not.toBe(bodies[0].batchId);
    expect(bodies[2].deltas[0]).toMatchObject({ inputTokens: 10, requests: 1 });
  });

  it("sends nothing when there is nothing to send", async () => {
    const state = new GateState();
    state.applySnapshot(SNAP, 0);
    const { impl } = portalFetch({});
    const sync = createSync({ state, portal: createPortalClient({ portalUrl: "http://p", secret: "s", fetchImpl: impl }), now: () => 1, log: {} });
    await sync.flush();
    expect(impl).not.toHaveBeenCalled();
  });

  it("runs one pull at a time and one more if asked during it", async () => {
    const state = new GateState();
    let release;
    const gateOpen = new Promise((r) => (release = r));
    let pulls = 0;
    const portal = { pullSnapshot: async () => { pulls++; await gateOpen; return { status: "ok", snapshot: SNAP }; }, pushBatch: async () => "ok" };
    const sync = createSync({ state, portal, now: () => 1, log: {} });
    const first = sync.pull();
    sync.pull();
    sync.pull();
    release();
    await first;
    await new Promise((r) => setTimeout(r, 10));
    expect(pulls).toBe(2);
  });

  it("runs one flush at a time, so two overlapping flushes cannot lose a batch", async () => {
    const state = new GateState();
    state.applySnapshot(SNAP, 0);
    let release;
    const slow = new Promise((r) => (release = r));
    const pushed = [];
    const portal = { pullSnapshot: async () => ({ status: "ok", snapshot: SNAP }), pushBatch: async (b) => { pushed.push(b.batchId); await slow; return "ok"; } };
    const sync = createSync({ state, portal, now: () => 1, log: {} });
    spend(state, 1);
    const first = sync.flush();
    spend(state, 1);
    const second = sync.flush();
    release();
    await Promise.all([first, second]);
    await sync.flush();
    expect(pushed).toHaveLength(2);
    expect(new Set(pushed).size).toBe(2);
  });

  it("drops a batch the portal rejects for good, releasing its budget hold, and moves on", async () => {
    const state = new GateState();
    state.applySnapshot(SNAP, 0);
    const results = ["drop", "ok"];
    const portal = { pullSnapshot: async () => ({ status: "ok", snapshot: SNAP }), pushBatch: async () => results.shift() };
    const warn = vi.fn();
    const sync = createSync({ state, portal, now: () => 1, log: { warn } });
    for (let i = 0; i < 7; i++) spend(state, 1);
    expect(state.check(hashKey("sk"), "ollama/q", 1)).toMatchObject({ ok: false, status: 429 });
    await sync.flush();
    expect(warn).toHaveBeenCalled();
    expect(state.check(hashKey("sk"), "ollama/q", 1)).toMatchObject({ ok: true });
  });

  it("drains everything on shutdown, retrying a failed push", async () => {
    const state = new GateState();
    state.applySnapshot(SNAP, 0);
    const results = ["retry", "ok", "ok"];
    const pushed = [];
    const portal = { pullSnapshot: async () => ({ status: "ok", snapshot: SNAP }), pushBatch: async (b) => { pushed.push(b.batchId); return results.shift(); } };
    const sync = createSync({ state, portal, now: () => 1, log: {} });
    spend(state, 1);
    await sync.flush();
    spend(state, 1);
    await sync.drain();
    expect(pushed).toHaveLength(3);
    expect(pushed[1]).toBe(pushed[0]);
    expect(state.drainBatch()).toBeNull();
  });
});
