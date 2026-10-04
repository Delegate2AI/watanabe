import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEgress } from "./egress";
import { createResolve, reasonOf, redirect, responder } from "./egress-fixtures";

const resolve = createResolve();

afterEach(() => {
  vi.unstubAllEnvs();
  resolve.mockClear();
});

describe("fetchEgress", () => {
  it("returns the response for a validated https url", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/mcp": () => new Response("hello", { status: 200 }),
    });

    const result = await fetchEgress("https://api.example.com/mcp", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(true);
    expect(result.ok && (await result.response.text())).toBe("hello");
    expect(calls).toEqual(["https://api.example.com/mcp"]);
  });

  it("refuses before issuing a request when the url does not validate", async () => {
    const { impl } = responder({});

    const result = await fetchEgress("https://meta.example.com/x", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(impl).not.toHaveBeenCalled();
  });

  it("asks the transport not to follow redirects itself", async () => {
    const { impl } = responder({
      "https://api.example.com/mcp": () => new Response("hello"),
    });

    await fetchEgress("https://api.example.com/mcp", {}, { resolve, fetchImpl: impl });

    const init = impl.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("follows a same origin redirect chain up to three hops", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/1": () => redirect("/2"),
      "https://api.example.com/2": () => redirect("/3"),
      "https://api.example.com/3": () => redirect("/4"),
      "https://api.example.com/4": () => new Response("done"),
    });

    const result = await fetchEgress("https://api.example.com/1", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(true);
    expect(result.ok && (await result.response.text())).toBe("done");
    expect(calls).toHaveLength(4);
  });

  it("refuses a chain of four redirects", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("/2"),
      "https://api.example.com/2": () => redirect("/3"),
      "https://api.example.com/3": () => redirect("/4"),
      "https://api.example.com/4": () => redirect("/5"),
      "https://api.example.com/5": () => new Response("done"),
    });

    const result = await fetchEgress("https://api.example.com/1", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("redirect");
  });

  it("re-validates each hop and refuses a redirect to a private address", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/1": () => redirect("https://internal.example.com/2"),
      "https://internal.example.com/2": () => new Response("secret"),
    });

    const result = await fetchEgress("https://api.example.com/1", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(calls).toEqual(["https://api.example.com/1"]);
  });

  it("refuses a cross origin redirect that no approved origin covers", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("https://other.example.com/2"),
      "https://other.example.com/2": () => new Response("done"),
    });

    const result = await fetchEgress("https://api.example.com/1", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("origin");
  });

  it("admits exactly the approved origin and nothing beside it", async () => {
    const routes = {
      "https://api.example.com/1": () => redirect("https://approved.example.com/2"),
      "https://approved.example.com/2": () => new Response("done"),
      "https://api.example.com/9": () => redirect("https://other.example.com/2"),
      "https://other.example.com/2": () => new Response("done"),
    };
    const approvedOrigins = ["https://approved.example.com"];

    const allowed = await fetchEgress(
      "https://api.example.com/1",
      {},
      { resolve, fetchImpl: responder(routes).impl, approvedOrigins },
    );
    const refused = await fetchEgress(
      "https://api.example.com/9",
      {},
      { resolve, fetchImpl: responder(routes).impl, approvedOrigins },
    );

    expect(allowed.ok).toBe(true);
    expect(refused.ok).toBe(false);
  });

  it("refuses any cross origin redirect for a request carrying an Authorization header", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("https://approved.example.com/2"),
      "https://approved.example.com/2": () => new Response("done"),
    });

    const result = await fetchEgress(
      "https://api.example.com/1",
      { headers: { Authorization: "Bearer secret" } },
      { resolve, fetchImpl: impl, approvedOrigins: ["https://approved.example.com"] },
    );

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("credential");
  });

  it("follows a same origin redirect for a request carrying an Authorization header", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("/2"),
      "https://api.example.com/2": () => new Response("done"),
    });

    const result = await fetchEgress(
      "https://api.example.com/1",
      { headers: new Headers({ authorization: "Bearer secret" }) },
      { resolve, fetchImpl: impl },
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a protocol downgrade for a request carrying an Authorization header", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("http://localhost:3100/2"),
      "http://localhost:3100/2": () => new Response("done"),
    });

    const result = await fetchEgress(
      "https://api.example.com/1",
      { headers: [["Authorization", "Bearer secret"]] },
      { resolve, fetchImpl: impl, approvedOrigins: ["http://localhost:3100"] },
    );

    expect(result.ok).toBe(false);
  });

  it("refuses a redirect that carries no location header", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => new Response(null, { status: 302 }),
    });

    const result = await fetchEgress("https://api.example.com/1", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(false);
  });

  it("converts a POST into a GET and drops the body on a 303 redirect", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("/2", 303),
      "https://api.example.com/2": () => new Response("done"),
    });

    const result = await fetchEgress(
      "https://api.example.com/1",
      { method: "POST", body: "payload" },
      { resolve, fetchImpl: impl },
    );

    expect(result.ok).toBe(true);
    const secondInit = impl.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe("GET");
    expect(secondInit.body).toBeUndefined();
  });

  it("preserves the method and body across a 307 redirect", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("/2", 307),
      "https://api.example.com/2": () => new Response("done"),
    });

    const result = await fetchEgress(
      "https://api.example.com/1",
      { method: "POST", body: "payload" },
      { resolve, fetchImpl: impl },
    );

    expect(result.ok).toBe(true);
    const secondInit = impl.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe("POST");
    expect(secondInit.body).toBe("payload");
  });

  it("treats a 304 as a response rather than a redirect to follow", async () => {
    const { impl, calls } = responder({
      "https://api.example.com/mcp": () =>
        new Response(null, { status: 304, headers: { location: "/elsewhere" } }),
    });

    const result = await fetchEgress("https://api.example.com/mcp", {}, { resolve, fetchImpl: impl });

    expect(result.ok && result.response.status).toBe(304);
    expect(calls).toEqual(["https://api.example.com/mcp"]);
  });

  it("shares one dispatcher and one abort signal across every hop", async () => {
    const { impl } = responder({
      "https://api.example.com/1": () => redirect("/2"),
      "https://api.example.com/2": () => new Response("done"),
    });

    await fetchEgress("https://api.example.com/1", {}, { resolve, fetchImpl: impl });

    const [firstInit, secondInit] = impl.mock.calls.map((call) => call[1] as RequestInit);
    expect(secondInit.signal).toBe(firstInit.signal);
    expect((secondInit as { dispatcher?: unknown }).dispatcher).toBe(
      (firstInit as { dispatcher?: unknown }).dispatcher,
    );
  });

  it("keeps the status and headers of the response it returns", async () => {
    const { impl } = responder({
      "https://api.example.com/mcp": () =>
        new Response("nope", { status: 418, headers: { "content-type": "text/plain" } }),
    });

    const result = await fetchEgress("https://api.example.com/mcp", {}, { resolve, fetchImpl: impl });

    expect(result.ok && result.response.status).toBe(418);
    expect(result.ok && result.response.headers.get("content-type")).toBe("text/plain");
  });

  it("returns a scrubbed refusal rather than throwing when the transport fails", async () => {
    const impl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED /var/run/private.sock");
    });

    const result = await fetchEgress("https://api.example.com/mcp", {}, { resolve, fetchImpl: impl });

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain("<path>");
    expect(reasonOf(result)).not.toContain("private.sock");
  });
});
