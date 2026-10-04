import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const captured: Array<Record<string, unknown>> = [];
const exceptions: Array<{
  error: unknown;
  distinctId?: string;
  additionalProperties?: Record<string, unknown>;
}> = [];
const shutdowns: number[] = [];
const constructed: Array<{ key: string; options: Record<string, unknown> }> = [];
let throwOnCapture = false;

vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(key: string, options: Record<string, unknown>) {
      constructed.push({ key, options });
    }
    capture(message: Record<string, unknown>) {
      if (throwOnCapture) throw new Error("transport down");
      captured.push(message);
    }
    captureException(
      error: unknown,
      distinctId?: string,
      additionalProperties?: Record<string, unknown>,
    ) {
      if (throwOnCapture) throw new Error("transport down");
      exceptions.push({ error, distinctId, additionalProperties });
    }
    async shutdown() {
      shutdowns.push(1);
    }
  },
}));

const KEY = "phc_testtesttesttesttesttest";

async function freshModule() {
  vi.resetModules();
  return import("./server");
}

beforeEach(() => {
  captured.length = 0;
  exceptions.length = 0;
  shutdowns.length = 0;
  constructed.length = 0;
  throwOnCapture = false;
  process.env.ANALYTICS_ENABLED = "1";
  process.env.POSTHOG_KEY = KEY;
  process.env.POSTHOG_HOST = "https://ph.example.com";
});

afterEach(() => {
  delete process.env.ANALYTICS_ENABLED;
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
});

describe("captureServerEvent", () => {
  it("sends the event with its distinct id and properties", async () => {
    const { captureServerEvent } = await freshModule();
    captureServerEvent("doc_created", { distinctId: "abc", properties: { visibility: "private" } });
    expect(captured).toEqual([
      {
        distinctId: "abc",
        event: "doc_created",
        properties: expect.objectContaining({ visibility: "private" }),
      },
    ]);
  });

  it("marks every server event so client and server traffic stay separable", async () => {
    const { captureServerEvent } = await freshModule();
    captureServerEvent("doc_created", { distinctId: "abc" });
    expect(captured[0].properties).toMatchObject({ service: "watanabe-server" });
  });

  it("builds the client once against the configured host", async () => {
    const { captureServerEvent } = await freshModule();
    captureServerEvent("doc_created", { distinctId: "abc" });
    captureServerEvent("doc_shared", { distinctId: "abc" });
    expect(constructed).toHaveLength(1);
    expect(constructed[0].key).toBe(KEY);
    expect(constructed[0].options).toMatchObject({ host: "https://ph.example.com" });
  });

  it("sends nothing when analytics is off", async () => {
    delete process.env.ANALYTICS_ENABLED;
    const { captureServerEvent } = await freshModule();
    captureServerEvent("doc_created", { distinctId: "abc" });
    expect(constructed).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("swallows a transport failure rather than breaking its caller", async () => {
    const { captureServerEvent } = await freshModule();
    throwOnCapture = true;
    expect(() => captureServerEvent("doc_created", { distinctId: "abc" })).not.toThrow();
  });
});

describe("property scrubbing", () => {
  it("strips an address out of a property value, whatever the key is called", async () => {
    const { captureServerEvent } = await freshModule();
    captureServerEvent("doc_shared", {
      distinctId: "abc",
      properties: { owner: "alice@example.com", note: "shared with bob@example.com by hand" },
    });
    expect(captured[0].properties).toMatchObject({
      owner: "<email>",
      note: "shared with <email> by hand",
    });
  });

  it("reaches an address nested one level down, where an error's fields live", async () => {
    const { captureServerException } = await freshModule();
    captureServerException(new Error("boom"), {
      properties: { fields: { owner: "alice@example.com" }, paths: ["mailto:bob@example.com"] },
    });
    expect(exceptions[0].additionalProperties).toMatchObject({
      fields: { owner: "<email>" },
      paths: ["mailto:<email>"],
    });
  });

  it("leaves everything that is not an address alone", async () => {
    const { captureServerEvent } = await freshModule();
    captureServerEvent("doc_created", {
      distinctId: "abc",
      properties: { route: "POST /api/docs", status: 500, ok: false, missing: null },
    });
    expect(captured[0].properties).toMatchObject({
      route: "POST /api/docs",
      status: 500,
      ok: false,
      missing: null,
    });
  });

  it("never scrubs the distinct id, which is already a hash", async () => {
    const { captureServerEvent } = await freshModule();
    captureServerEvent("doc_created", { distinctId: "a".repeat(32) });
    expect(captured[0].distinctId).toBe("a".repeat(32));
  });
});

describe("captureServerException", () => {
  it("sends PostHog's own $exception, carrying the error and the context", async () => {
    const { captureServerException } = await freshModule();
    const thrown = new Error("boom");
    captureServerException(thrown, { distinctId: "abc", properties: { route: "/api/docs" } });
    expect(exceptions[0].distinctId).toBe("abc");
    expect((exceptions[0].error as Error).message).toBe("boom");
    expect(String((exceptions[0].error as Error).stack)).toContain("Error: boom");
    expect(exceptions[0].additionalProperties).toMatchObject({ route: "/api/docs" });
  });

  it("keeps the error's own name, which is what groups an issue", async () => {
    const { captureServerException } = await freshModule();
    class RepoWriteError extends Error {}
    const thrown = new RepoWriteError("push rejected");
    thrown.name = "RepoWriteError";
    captureServerException(thrown);
    expect((exceptions[0].error as Error).name).toBe("RepoWriteError");
  });

  it("takes an address out of the message, which no property scrub would reach", async () => {
    const { captureServerException } = await freshModule();
    captureServerException(new Error("no mailbox for alice@example.com"));
    expect((exceptions[0].error as Error).message).toBe("no mailbox for <email>");
  });

  it("wraps a non-Error so the stack-less throw still reports", async () => {
    const { captureServerException } = await freshModule();
    captureServerException("just a string");
    expect((exceptions[0].error as Error).message).toBe("just a string");
  });

  it("truncates a runaway stack rather than shipping the whole thing", async () => {
    const { captureServerException } = await freshModule();
    const error = new Error("deep");
    error.stack = "x".repeat(9000);
    captureServerException(error);
    expect(String((exceptions[0].error as Error).stack)).toHaveLength(2000);
  });

  it("attributes to no one in particular when there is no person to name", async () => {
    const { captureServerException } = await freshModule();
    captureServerException(new Error("boom"));
    expect(exceptions[0].distinctId).toBe("server");
  });

  it("swallows a transport failure rather than breaking its caller", async () => {
    const { captureServerException } = await freshModule();
    throwOnCapture = true;
    expect(() => captureServerException(new Error("boom"))).not.toThrow();
  });

  it("sends nothing when analytics is off", async () => {
    delete process.env.POSTHOG_KEY;
    const { captureServerException } = await freshModule();
    captureServerException(new Error("boom"));
    expect(exceptions).toHaveLength(0);
  });
});

describe("flushAnalytics", () => {
  it("shuts the client down when one was built", async () => {
    const { captureServerEvent, flushAnalytics } = await freshModule();
    captureServerEvent("doc_created", { distinctId: "abc" });
    await flushAnalytics();
    expect(shutdowns).toHaveLength(1);
  });

  it("is a no-op when nothing was ever sent", async () => {
    const { flushAnalytics } = await freshModule();
    await expect(flushAnalytics()).resolves.toBeUndefined();
    expect(shutdowns).toHaveLength(0);
  });
});
