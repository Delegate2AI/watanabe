// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { isUnavailable, useCapabilities } from "./capabilities";

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

const ok = (body: unknown) =>
  stubFetch(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("isUnavailable", () => {
  it("is true only for a capability the server said is off", () => {
    expect(isUnavailable(false)).toBe(true);
  });

  it("is false for an available capability", () => {
    expect(isUnavailable(true)).toBe(false);
  });

  it("is false for an unknown capability, so a probe that never answered leaves controls enabled", () => {
    expect(isUnavailable(undefined)).toBe(false);
  });
});

describe("useCapabilities", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("starts unknown, so nothing is disabled during the first paint", () => {
    ok({ kbWrite: false, dictation: false });
    const { result } = renderHook(() => useCapabilities());
    expect(result.current.kbWrite).toBeUndefined();
    expect(result.current.dictation).toBeUndefined();
    expect(isUnavailable(result.current.kbWrite)).toBe(false);
  });

  it("reports what the route said once it answers", async () => {
    ok({ kbWrite: false, dictation: true });
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.kbWrite).toBe(false));
    expect(result.current.dictation).toBe(true);
    expect(isUnavailable(result.current.kbWrite)).toBe(true);
  });

  it("leaves capabilities unknown when the fetch rejects, never disabling the app on a transient failure", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kbWrite).toBeUndefined();
    expect(isUnavailable(result.current.kbWrite)).toBe(false);
  });

  it("leaves capabilities unknown on a non-ok response", async () => {
    stubFetch(async () => new Response("nope", { status: 500 }));
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kbWrite).toBeUndefined();
  });

  it("leaves capabilities unknown when the body is not the expected shape", async () => {
    ok({ kbWrite: "yes", dictation: null });
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kbWrite).toBeUndefined();
    expect(result.current.dictation).toBeUndefined();
  });

  it("asks the capabilities route exactly once per mount", async () => {
    const mock = ok({ kbWrite: true, dictation: true });
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toBe("/api/capabilities");
  });
});
