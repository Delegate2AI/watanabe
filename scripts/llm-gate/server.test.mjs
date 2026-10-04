import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGateServer } from "./server.mjs";
import { GateState, hashKey } from "./state.mjs";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const KEY = "sk-9r-ana";

function snapshot() {
  const budget = (over) => ({
    ownerEmail: "ana@corp.io", allowed: true, tokens: null, period: "month", periodStart: "2026-10-01",
    resetAt: "2026-11-01T00:00:00.000Z", used: 0, bonus: 0, ...over,
  });
  return {
    generatedAt: new Date(NOW).toISOString(),
    keys: [{ id: "k1", hash: hashKey(KEY), ownerEmail: "ana@corp.io" }],
    groups: [
      { slug: "local", models: ["ollama/*"] },
      { slug: "paid", models: ["anthropic/*"] },
      { slug: "spent", models: ["openai/*"] },
    ],
    budgets: [
      budget({ groupSlug: "local" }),
      budget({ groupSlug: "paid", tokens: 1_000_000 }),
      budget({ groupSlug: "spent", tokens: 10, used: 10 }),
    ],
  };
}

let upstream;
let upstreamUrl;
let seen;
let reply;
let gate;
let gateUrl;
let state;
let invalidated;

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

beforeEach(async () => {
  seen = [];
  reply = (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } }));
  };
  upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    reply(req, res);
  });
  upstreamUrl = await listen(upstream);
  state = new GateState();
  state.applySnapshot(snapshot(), NOW);
  invalidated = 0;
  gate = createGateServer({
    state, routerUrl: upstreamUrl, secret: "s3cret", helpUrl: "https://portal/settings/llm",
    onInvalidate: () => invalidated++, now: () => NOW, log: {},
  });
  gateUrl = await listen(gate);
});

afterEach(async () => {
  await new Promise((r) => gate.close(r));
  upstream.closeAllConnections?.();
  await new Promise((r) => upstream.close(r));
});

function post(path, body, headers = { authorization: `Bearer ${KEY}` }) {
  return fetch(`${gateUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("llm-gate server", () => {
  it("answers health without a snapshot", async () => {
    state.markDisabled();
    expect((await fetch(`${gateUrl}/healthz`)).status).toBe(200);
  });

  it("forwards an allowed request with the caller's key and records its usage", async () => {
    const res = await post("/v1/messages", { model: "anthropic/claude-sonnet-4-5", messages: [] }, { "x-api-key": KEY, "accept-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ usage: { input_tokens: 10, output_tokens: 5 } });
    expect(seen[0].headers["x-api-key"]).toBe(KEY);
    expect(seen[0].headers["accept-encoding"]).toBe("identity");
    const batch = state.drainBatch();
    expect(batch.deltas[0]).toMatchObject({ groupSlug: "paid", inputTokens: 10, outputTokens: 5, requests: 1 });
  });

  it("refuses in the Anthropic shape on /v1/messages and the OpenAI shape elsewhere", async () => {
    const bad = await post("/v1/messages", { model: "anthropic/x" }, { authorization: "Bearer nope" });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ type: "error", error: { type: "authentication_error" } });
    const blocked = await post("/v1/chat/completions", { model: "mistral/large" });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.message).toMatch(/mistral\/large.*settings\/llm/);
    expect(seen).toHaveLength(0);
  });

  it("429s an exhausted budget with Retry-After and the reset time", async () => {
    const res = await post("/v1/chat/completions", { model: "openai/gpt-5" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error.message).toContain("2026-11-01T00:00:00.000Z");
  });

  it("streams an SSE reply through unchanged and reads usage from it", async () => {
    const events = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 40, output_tokens: 1 } } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 12 } })}\n\n`,
    ];
    reply = (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "content-encoding": "identity" });
      for (const e of events) res.write(e);
      res.end();
    };
    const res = await post("/v1/messages", { model: "ollama/qwen3", stream: true });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(events.join(""));
    expect(state.drainBatch().deltas[0]).toMatchObject({ groupSlug: "local", inputTokens: 40, outputTokens: 12 });
  });

  it("asks OpenAI streams for usage and fixes the content length", async () => {
    await post("/v1/chat/completions", { model: "ollama/qwen3", stream: true });
    const sent = JSON.parse(seen[0].body);
    expect(sent.stream_options).toEqual({ include_usage: true });
    expect(Number(seen[0].headers["content-length"])).toBe(Buffer.byteLength(seen[0].body));
  });

  it("passes an upstream error through and charges nothing", async () => {
    reply = (_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "boom" } }));
    };
    const res = await post("/v1/messages", { model: "anthropic/claude-sonnet-4-5" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { message: "boom" } });
    expect(state.drainBatch()).toBeNull();
  });

  it("does not charge count_tokens", async () => {
    await post("/v1/messages/count_tokens", { model: "anthropic/claude-sonnet-4-5" });
    expect(seen).toHaveLength(1);
    expect(state.drainBatch()).toBeNull();
  });

  it("charges an estimate when a reply carries no usage (B3)", async () => {
    reply = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    };
    const body = { model: "anthropic/claude-sonnet-4-5", messages: [{ role: "user", content: "x".repeat(400) }] };
    await post("/v1/messages", body);
    const delta = state.drainBatch().deltas[0];
    expect(delta.inputTokens).toBe(Math.ceil(Buffer.byteLength(JSON.stringify(body)) / 4));
    expect(delta.outputTokens).toBe(0);
  });

  it("filters /v1/models to the caller's allowed groups", async () => {
    reply = (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "ollama/qwen3" }, { id: "anthropic/claude-opus-5" }, { id: "mistral/large" }] }));
    };
    const res = await fetch(`${gateUrl}/v1/models`, { headers: { authorization: `Bearer ${KEY}` } });
    expect((await res.json()).data.map((m) => m.id)).toEqual(["ollama/qwen3", "anthropic/claude-opus-5"]);
  });

  it("refuses a request without a valid key before reading its body", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const res = await fetch(`${gateUrl}/v1/messages`, {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": "sk-nope" }, body: big,
    });
    expect(res.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("404s an unknown path and a wrong method", async () => {
    expect((await post("/v1/completions", { model: "x" })).status).toBe(404);
    expect((await fetch(`${gateUrl}/v1/messages`)).status).toBe(404);
  });

  it("guards /invalidate with the secret", async () => {
    expect((await fetch(`${gateUrl}/invalidate`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${gateUrl}/invalidate`, { method: "POST", headers: { "x-llm-gate-secret": "s3cret" } })).status).toBe(204);
    expect(invalidated).toBe(1);
  });

  it("aborts the upstream request and charges once when the client disconnects mid-stream", async () => {
    let upstreamClosed;
    const closed = new Promise((r) => (upstreamClosed = r));
    reply = (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 70, output_tokens: 1 } } })}\n\n`);
      req.socket.on("close", upstreamClosed);
    };
    const controller = new AbortController();
    const res = await fetch(`${gateUrl}/v1/messages`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: "anthropic/claude-sonnet-4-5", stream: true }),
    });
    const reader = res.body.getReader();
    await reader.read();
    controller.abort();
    await closed;
    await new Promise((r) => setTimeout(r, 50));
    const batch = state.drainBatch();
    expect(batch.deltas).toHaveLength(1);
    expect(batch.deltas[0]).toMatchObject({ inputTokens: 70, requests: 1 });
  });
});
