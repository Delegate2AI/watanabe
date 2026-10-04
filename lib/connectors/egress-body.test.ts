import { describe, expect, it } from "vitest";
import { readBoundedBody } from "./egress-body";

function chunkedResponse(chunks: Uint8Array[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, init);
}

function reasonOf(result: { ok: true } | { ok: false; reason: string }): string {
  return result.ok ? "" : result.reason;
}

describe("readBoundedBody", () => {
  it("refuses a response body over the cap", async () => {
    const result = await readBoundedBody(new Response(new Uint8Array(256_001)));

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("body");
  });

  it("accepts a response body exactly at the cap", async () => {
    const result = await readBoundedBody(new Response(new Uint8Array(256_000)));

    expect(result.ok).toBe(true);
    expect(result.ok && (await result.response.arrayBuffer()).byteLength).toBe(256_000);
  });

  it("refuses a body whose declared content length is over the cap", async () => {
    const response = new Response("small", { headers: { "content-length": "900000" } });

    const result = await readBoundedBody(response);

    expect(result.ok).toBe(false);
  });

  it("refuses a chunked stream with no content length once it crosses the cap", async () => {
    const chunks = [new Uint8Array(200_000), new Uint8Array(100_000)];
    const response = chunkedResponse(chunks);

    expect(response.headers.get("content-length")).toBeNull();

    const result = await readBoundedBody(response);

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("body");
  });

  it("accepts a chunked stream with no content length that stays under the cap", async () => {
    const chunks = [new Uint8Array(100_000), new Uint8Array(100_000)];
    const response = chunkedResponse(chunks);

    const result = await readBoundedBody(response);

    expect(result.ok).toBe(true);
    expect(result.ok && (await result.response.arrayBuffer()).byteLength).toBe(200_000);
  });

  it("keeps the status and headers of the response it returns", async () => {
    const response = new Response("nope", { status: 418, headers: { "content-type": "text/plain" } });

    const result = await readBoundedBody(response);

    expect(result.ok && result.response.status).toBe(418);
    expect(result.ok && result.response.headers.get("content-type")).toBe("text/plain");
  });
});
