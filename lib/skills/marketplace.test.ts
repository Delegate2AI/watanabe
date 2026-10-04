import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMarketplaceIndex } from "./marketplace";
import { MARKETPLACE_TIMEOUT_MS, MAX_INDEX_BYTES } from "./marketplace-http";

/**
 * Transport half of the marketplace index: what happens when the remote is
 * hostile, broken, or silent. Every test drives an injected fake `fetch`;
 * nothing touches the network. Entry parsing lives in marketplace-entries.test.ts.
 */

const INDEX_URL = "https://skills.example.com/index.json";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(response: Response) {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
}

/** A body delivered in chunks with no content-length, so only the read can cap it. */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchMarketplaceIndex, request shape", () => {
  it("requests JSON from the configured URL with an abort signal attached", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ skills: [] }));

    await fetchMarketplaceIndex(INDEX_URL, fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(INDEX_URL);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(String(new Headers(init.headers).get("accept"))).toContain("application/json");
  });

  it("refuses a non-http(s) index URL without calling fetch at all", async () => {
    const fetchMock = vi.fn();

    const result = await fetchMarketplaceIndex("file:///etc/passwd", fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("http");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a reason carrying the status for a non-200", async () => {
    const result = await fetchMarketplaceIndex(
      INDEX_URL,
      fakeFetch(new Response("nope", { status: 503 })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("503");
  });

  it("returns a reason rather than throwing when the request itself fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    const result = await fetchMarketplaceIndex(INDEX_URL, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("ENOTFOUND");
  });
});

describe("fetchMarketplaceIndex, timeout", () => {
  it("gives up after the request timeout and aborts the signal it handed to fetch", async () => {
    vi.useFakeTimers();
    // A server that answers nothing and ignores the abort: only the deadline
    // can end this call, which is the point of the assertion.
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(() => {}));

    const pending = fetchMarketplaceIndex(INDEX_URL, fetchMock as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(MARKETPLACE_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("timed out");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
  });

  it("times out while the body is still being read, not only before the headers", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"skills":'));
        // Never closed: the headers arrived, the body never finishes.
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));

    const pending = fetchMarketplaceIndex(INDEX_URL, fetchMock as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(MARKETPLACE_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("timed out");
  });
});

describe("fetchMarketplaceIndex, hostile bodies", () => {
  it("refuses a body whose declared content-length is over the cap", async () => {
    const response = jsonResponse({ skills: [] });
    response.headers.set("content-length", String(MAX_INDEX_BYTES + 1));

    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(response));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("too large");
  });

  it("refuses a chunked body that grows past the cap with no content-length", async () => {
    const chunk = "x".repeat(100_000);
    const chunks = Array.from({ length: Math.ceil(MAX_INDEX_BYTES / chunk.length) + 1 }, () => chunk);

    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(streamResponse(chunks)));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("too large");
  });

  it("returns a reason for HTML served where JSON was promised", async () => {
    const html = new Response("<!doctype html><html><body>login</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(html));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not valid JSON");
  });

  it("never quotes the served bytes back, since a redirect makes them any host's", async () => {
    const secrets = new Response('aws-secret-access-key: AKIAIOSFODNN7EXAMPLE', {
      status: 200,
      headers: { "content-type": "text/plain" },
    });

    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(secrets));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain("aws-secret");
  });

  it("never names the keys of a JSON body that is not an index", async () => {
    const internal = jsonResponse({ AWS_SECRET_ACCESS_KEY: "AKIA", db_password: "hunter2" });

    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(internal));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("AWS_SECRET_ACCESS_KEY");
      expect(result.reason).not.toContain("db_password");
      expect(result.reason).not.toContain("hunter2");
      // Still diagnosable for an admin reading their own index.
      expect(result.reason).toContain("skills");
    }
  });

  it("still says which of the three shape failures it was", async () => {
    const cases: Array<[unknown, string]> = [
      [[1, 2, 3], "must be a JSON object"],
      [{ skills: "nope" }, "is missing or is not an array"],
      [{ skills: [], extra: 1, more: 2 }, "2 unrecognized top-level keys"],
    ];

    for (const [body, expected] of cases) {
      const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(jsonResponse(body)));

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(expected);
    }
  });

  it("returns a readable reason, not a ZodError blob, for JSON of the wrong shape", async () => {
    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(jsonResponse({ items: [] })));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("skills");
      expect(result.reason).not.toContain('"code"');
      expect(result.reason.split("\n")).toHaveLength(1);
    }
  });

  it("rejects a top-level JSON array", async () => {
    const result = await fetchMarketplaceIndex(INDEX_URL, fakeFetch(jsonResponse([{ name: "a" }])));

    expect(result.ok).toBe(false);
  });

  it("rejects an index carrying unknown top-level keys", async () => {
    const result = await fetchMarketplaceIndex(
      INDEX_URL,
      fakeFetch(jsonResponse({ skills: [], extra: true })),
    );

    expect(result.ok).toBe(false);
  });
});
