// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MODELS_PROBE_URL,
  PROBE_FAILURE_RETRY_MS,
  availableModelAllowlist,
  clearServedModelCache,
  servedModelIds,
} from "./model-availability";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/log", () => ({
  log: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() },
}));

const ORIGINAL = {
  model: process.env.AGENT_CHAT_MODEL,
  models: process.env.AGENT_CHAT_MODELS,
  apiKey: process.env.AGENT_CHAT_API_KEY,
  oauth: process.env.AGENT_CHAT_OAUTH_TOKEN,
};

function servedResponse(ids: string[]): Response {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
}

beforeEach(() => {
  clearServedModelCache();
  warn.mockReset();
  delete process.env.AGENT_CHAT_OAUTH_TOKEN;
  process.env.AGENT_CHAT_API_KEY = "sk-test";
  process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
  process.env.AGENT_CHAT_MODELS =
    "claude-fable-5-1,claude-opus-5,claude-sonnet-5,claude-haiku-4-5-20251001";
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of [
    ["AGENT_CHAT_MODEL", ORIGINAL.model],
    ["AGENT_CHAT_MODELS", ORIGINAL.models],
    ["AGENT_CHAT_API_KEY", ORIGINAL.apiKey],
    ["AGENT_CHAT_OAUTH_TOKEN", ORIGINAL.oauth],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("servedModelIds credential shape", () => {
  it("sends x-api-key and the version header for an API key", async () => {
    const fetchMock = vi.fn(async () => servedResponse(["claude-opus-4-8"]));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await servedModelIds();

    expect(fetchMock).toHaveBeenCalledWith(MODELS_PROBE_URL, {
      headers: { "anthropic-version": "2023-06-01", "x-api-key": "sk-test" },
    });
  });

  it("prefers an OAuth token, sending Bearer plus the oauth beta header", async () => {
    process.env.AGENT_CHAT_OAUTH_TOKEN = "oat-test";
    const fetchMock = vi.fn(async () => servedResponse(["claude-opus-4-8"]));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await servedModelIds();

    expect(fetchMock).toHaveBeenCalledWith(MODELS_PROBE_URL, {
      headers: {
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        Authorization: "Bearer oat-test",
      },
    });
  });

  it("never fetches when the deploy has no injected credential", async () => {
    delete process.env.AGENT_CHAT_API_KEY;
    const fetchMock = vi.fn(async () => servedResponse(["claude-opus-4-8"]));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    expect(await servedModelIds()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("servedModelIds caching", () => {
  it("probes once per process on success", async () => {
    const fetchMock = vi.fn(async () => servedResponse(["claude-opus-4-8"]));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await servedModelIds();
    await servedModelIds();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("holds a failure for the retry window, then probes again", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    expect(await servedModelIds(1_000)).toBeNull();
    expect(await servedModelIds(1_000 + PROBE_FAILURE_RETRY_MS - 1)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await servedModelIds(1_000 + PROBE_FAILURE_RETRY_MS)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a non-2xx response and an empty list as a failed probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
    );
    expect(await servedModelIds()).toBeNull();

    clearServedModelCache();
    vi.stubGlobal("fetch", vi.fn(async () => servedResponse([])) as unknown as typeof fetch);
    expect(await servedModelIds()).toBeNull();
  });
});

describe("availableModelAllowlist", () => {
  it("drops ids the key cannot reach and logs each one once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        servedResponse(["claude-opus-4-8", "claude-opus-5"]),
      ) as unknown as typeof fetch,
    );

    const first = await availableModelAllowlist();
    const second = await availableModelAllowlist();

    expect(first.map((m) => m.id)).toEqual(["claude-opus-4-8", "claude-opus-5"]);
    expect(second.map((m) => m.id)).toEqual(["claude-opus-4-8", "claude-opus-5"]);
    const dropped = warn.mock.calls.filter((c) => c[0] === "model dropped from the allowlist");
    expect(dropped).toHaveLength(3);
  });

  it("keeps the default even when the probe does not list it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => servedResponse(["claude-sonnet-5"])) as unknown as typeof fetch,
    );

    const list = await availableModelAllowlist();

    expect(list.map((m) => m.id)).toEqual(["claude-opus-4-8", "claude-sonnet-5"]);
  });

  it("returns the unfiltered list when the probe fails, never an empty one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );

    const list = await availableModelAllowlist();

    expect(list.map((m) => m.id)).toEqual([
      "claude-opus-4-8",
      "claude-fable-5-1",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
    ]);
  });
});
