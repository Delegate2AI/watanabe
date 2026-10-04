import { beforeEach, describe, expect, it } from "vitest";
import { GateState, hashKey } from "./state.mjs";

const T0 = Date.parse("2026-10-04T12:00:00.000Z");

function snapshot(over = {}) {
  return {
    generatedAt: new Date(T0).toISOString(),
    keys: [{ id: "k1", hash: hashKey("sk-ana"), ownerEmail: "ana@corp.io" }],
    groups: [
      { slug: "local", models: ["ollama/*"] },
      { slug: "paid", models: ["anthropic/*"] },
      { slug: "shut", models: ["openai/*"] },
    ],
    budgets: [
      budget({ groupSlug: "local", tokens: null }),
      budget({ groupSlug: "paid", tokens: 1000, used: 400, bonus: 100 }),
      budget({ groupSlug: "shut", allowed: false }),
    ],
    ...over,
  };
}

function budget(over) {
  return {
    ownerEmail: "ana@corp.io", groupSlug: "paid", allowed: true, tokens: 1000, period: "month",
    periodStart: "2026-10-01", resetAt: "2026-11-01T00:00:00.000Z", used: 0, bonus: 0, ...over,
  };
}

const usage = (input, output, cacheRead = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead });

let state;
beforeEach(() => {
  state = new GateState();
  state.applySnapshot(snapshot(), T0);
});

describe("GateState.check", () => {
  it("refuses everything with 503 before the first snapshot, when disabled, and once stale", () => {
    expect(new GateState().check(hashKey("sk-ana"), "ollama/x", T0)).toMatchObject({ ok: false, status: 503 });
    expect(state.check(hashKey("sk-ana"), "ollama/x", T0 + 10 * 60 * 1000 + 1)).toMatchObject({ ok: false, status: 503 });
    state.markDisabled();
    expect(state.check(hashKey("sk-ana"), "ollama/x", T0)).toMatchObject({ ok: false, status: 503 });
  });

  it("401s an unknown key and a key dropped by a newer snapshot", () => {
    expect(state.check(hashKey("sk-nope"), "ollama/x", T0)).toMatchObject({ ok: false, status: 401 });
    state.applySnapshot(snapshot({ keys: [] }), T0 + 1);
    expect(state.check(hashKey("sk-ana"), "ollama/x", T0 + 1)).toMatchObject({ ok: false, status: 401 });
  });

  it("403s a model in no group and a blocked group, naming the model", () => {
    expect(state.check(hashKey("sk-ana"), "mistral/large", T0)).toMatchObject({ ok: false, status: 403, model: "mistral/large" });
    expect(state.check(hashKey("sk-ana"), "openai/gpt-5", T0)).toMatchObject({ ok: false, status: 403 });
  });

  it("passes an unlimited group and a group with tokens left", () => {
    expect(state.check(hashKey("sk-ana"), "ollama/qwen3", T0)).toMatchObject({ ok: true, key: { id: "k1" } });
    expect(state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0)).toMatchObject({ ok: true });
  });

  it("checks only the key when there is no model", () => {
    expect(state.check(hashKey("sk-ana"), null, T0)).toMatchObject({ ok: true, budget: null });
  });

  it("429s with the reset time once limit plus bonus minus used and pending reaches zero", () => {
    const ok = state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0);
    state.record({ check: ok, model: "anthropic/claude-sonnet-4-5", usage: usage(500, 199, 9999), now: T0 });
    expect(state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0)).toMatchObject({ ok: true });
    state.record({ check: ok, model: "anthropic/claude-sonnet-4-5", usage: usage(0, 1), now: T0 });
    expect(state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0)).toMatchObject({
      ok: false, status: 429, resetAt: "2026-11-01T00:00:00.000Z", groupSlug: "paid",
    });
  });
});

describe("GateState batches", () => {
  function spend(input, output) {
    const ok = state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0);
    state.record({ check: ok, model: "anthropic/claude-sonnet-4-5", usage: usage(input, output, 7), now: T0 });
  }

  it("drains deltas grouped by owner, group, model, period and day, with key touches", () => {
    spend(10, 1);
    spend(20, 2);
    const batch = state.drainBatch();
    expect(batch.deltas).toEqual([{
      ownerEmail: "ana@corp.io", groupSlug: "paid", model: "anthropic/claude-sonnet-4-5", periodStart: "2026-10-01",
      day: "2026-10-04", inputTokens: 30, outputTokens: 3, cacheReadTokens: 14, requests: 2,
    }]);
    expect(batch.touched).toEqual([{ id: "k1", at: "2026-10-04T12:00:00.000Z" }]);
    expect(state.drainBatch()).toBeNull();
  });

  it("keeps a confirmed batch counting until a snapshot fetched after the flush arrives (B6)", () => {
    spend(400, 299);
    const batch = state.drainBatch();
    state.confirmBatch(batch, T0 + 5000);
    state.applySnapshot(snapshot(), T0 + 4000);
    spend(0, 1);
    expect(state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0 + 4000)).toMatchObject({ status: 429 });
    const after = snapshot({ budgets: [budget({ used: 400 + 699, bonus: 200 })] });
    state.applySnapshot(after, T0 + 6000);
    expect(state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0 + 6000)).toMatchObject({ ok: true });
  });

  it("keeps an unconfirmed batch counting however many snapshots arrive", () => {
    spend(400, 299);
    state.drainBatch();
    state.applySnapshot(snapshot(), T0 + 60_000);
    spend(0, 1);
    expect(state.check(hashKey("sk-ana"), "anthropic/claude-sonnet-4-5", T0 + 60_000)).toMatchObject({ status: 429 });
  });
});
