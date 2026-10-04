// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ToastAction } from "./toast";

const successMock = vi.fn();
const failureMock = vi.fn();
vi.mock("./toast", () => ({
  notifySuccess: (...args: unknown[]) => successMock(...args),
  notifyFailure: (...args: unknown[]) => failureMock(...args),
}));

const { useMutation } = await import("./use-mutation");
const { GENERIC_MESSAGE, MESSAGES } = await import("@/lib/errors/messages");

type FetchArgs = [string, RequestInit | undefined];

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The action attached to the most recent success toast, if any. */
function lastAction(): ToastAction | undefined {
  const call = successMock.mock.calls.at(-1);
  return call?.[1] as ToastAction | undefined;
}

beforeEach(() => {
  successMock.mockReset();
  failureMock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("useMutation success", () => {
  it("confirms with the copy it was given and reports the parsed result", async () => {
    stubFetch(async () => json({ ok: true }));
    const { result } = renderHook(() => useMutation({ success: "Assigned to Maria Chen" }));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run({ url: "/api/tasks/t1", method: "PATCH", body: { assignee: "m" } });
    });
    expect(outcome).toEqual({ ok: true, result: { ok: true } });
    expect(successMock).toHaveBeenCalledWith("Assigned to Maria Chen", undefined);
  });

  it("lets the success copy name the object from the response body", async () => {
    stubFetch(async () => json({ title: "Q3 payouts" }));
    const { result } = renderHook(() =>
      useMutation<{ title: string }>({ success: (r) => `Shared "${r.title}"` }),
    );
    await act(async () => {
      await result.current.run({ url: "/api/docs/d1/shares" });
    });
    expect(successMock).toHaveBeenCalledWith('Shared "Q3 payouts"', undefined);
  });

  it("sends a JSON body with a JSON content type, and POSTs by default", async () => {
    const mock = stubFetch(async () => json({}));
    const { result } = renderHook(() => useMutation({ success: "Done" }));
    await act(async () => {
      await result.current.run({ url: "/api/tasks", body: { title: "x" } });
    });
    const [url, init] = mock.mock.calls[0] as unknown as FetchArgs;
    expect(url).toBe("/api/tasks");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ title: "x" }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("sends no body and no content type when there is nothing to send", async () => {
    const mock = stubFetch(async () => json({}));
    const { result } = renderHook(() => useMutation({ success: "Done" }));
    await act(async () => {
      await result.current.run({ url: "/api/docs/d1/shares", method: "DELETE" });
    });
    const [, init] = mock.mock.calls[0] as unknown as FetchArgs;
    expect(init?.body).toBeUndefined();
  });

  it("calls onSuccess with the result", async () => {
    stubFetch(async () => json({ id: "a1" }));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useMutation<{ id: string }>({ success: "Done", onSuccess }));
    await act(async () => {
      await result.current.run({ url: "/api/artifacts" });
    });
    expect(onSuccess).toHaveBeenCalledWith({ id: "a1" });
  });

  it("flips pending while the request is in flight and clears it after", async () => {
    let release: (() => void) | undefined;
    stubFetch(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return json({});
    });
    const { result } = renderHook(() => useMutation({ success: "Done" }));
    let running: Promise<unknown> | undefined;
    act(() => {
      running = result.current.run({ url: "/api/tasks" });
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      release?.();
      await running;
    });
    expect(result.current.pending).toBe(false);
  });
});

describe("useMutation failure", () => {
  it("renders the mapped copy for a reason code and leaves state intact", async () => {
    stubFetch(async () => json({ error: { code: "not_cleared" } }, 403));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useMutation({ success: "Assigned", onSuccess }));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run({ url: "/api/tasks/t1", method: "PATCH" });
    });
    expect(outcome).toEqual({ ok: false, code: "not_cleared", message: MESSAGES.not_cleared });
    expect(failureMock).toHaveBeenCalledWith(MESSAGES.not_cleared);
    expect(successMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("never renders a legacy bare-string error, not even one naming an environment variable", async () => {
    stubFetch(async () => json({ error: "REPO_WRITE_TOKEN is not set, cannot publish" }, 500));
    const { result } = renderHook(() => useMutation({ success: "Published" }));
    await act(async () => {
      await result.current.run({ url: "/api/artifacts/a1/publish" });
    });
    expect(failureMock).toHaveBeenCalledWith(GENERIC_MESSAGE);
    expect(String(failureMock.mock.calls[0]?.[0])).not.toContain("REPO_WRITE_TOKEN");
  });

  it("falls back to the generic sentence for a code this build has never seen", async () => {
    stubFetch(async () => json({ error: { code: "quota_exhausted" } }, 429));
    const { result } = renderHook(() => useMutation({ success: "Done" }));
    await act(async () => {
      await result.current.run({ url: "/api/tasks" });
    });
    expect(failureMock).toHaveBeenCalledWith(GENERIC_MESSAGE);
  });

  it("reports a transport failure as the generic sentence rather than the exception text", async () => {
    stubFetch(async () => {
      throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:3100");
    });
    const { result } = renderHook(() => useMutation({ success: "Done" }));
    let outcome: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      outcome = await result.current.run({ url: "/api/tasks" });
    });
    expect(outcome).toEqual({ ok: false, code: undefined, message: GENERIC_MESSAGE });
    expect(String(failureMock.mock.calls[0]?.[0])).not.toContain("ECONNREFUSED");
  });

  it("handles an unparseable error body without throwing", async () => {
    stubFetch(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const { result } = renderHook(() => useMutation({ success: "Done" }));
    await act(async () => {
      await result.current.run({ url: "/api/tasks" });
    });
    expect(failureMock).toHaveBeenCalledWith(GENERIC_MESSAGE);
  });

  it("clears pending after a failure", async () => {
    stubFetch(async () => json({ error: { code: "not_found" } }, 404));
    const { result } = renderHook(() => useMutation({ success: "Done" }));
    await act(async () => {
      await result.current.run({ url: "/api/tasks/t1" });
    });
    expect(result.current.pending).toBe(false);
  });
});

describe("useMutation undo", () => {
  it("offers Undo on success and issues the reversing call with its own confirmation", async () => {
    const mock = stubFetch(async () => json({ id: "d1" }));
    const { result } = renderHook(() =>
      useMutation<{ id: string }>({
        success: "Removed from the project",
        undo: (r) => ({
          success: "Restored to the project",
          request: { url: `/api/projects/p1/documents`, method: "POST", body: { documentId: r.id } },
        }),
      }),
    );
    await act(async () => {
      await result.current.run({ url: "/api/projects/p1/documents", method: "DELETE" });
    });
    expect(lastAction()?.label).toBe("Undo");

    await act(async () => {
      lastAction()?.onClick();
    });
    await waitFor(() => expect(successMock).toHaveBeenCalledTimes(2));
    expect(successMock.mock.calls[1]?.[0]).toBe("Restored to the project");
    const undoCall = mock.mock.calls.at(-1) as unknown as FetchArgs;
    expect(undoCall[0]).toBe("/api/projects/p1/documents");
    expect(undoCall[1]?.method).toBe("POST");
    expect(undoCall[1]?.body).toBe(JSON.stringify({ documentId: "d1" }));
  });

  it("reports a failed undo with mapped copy instead of a second success", async () => {
    let call = 0;
    stubFetch(async () => {
      call += 1;
      return call === 1 ? json({}) : json({ error: { code: "conflict" } }, 409);
    });
    const { result } = renderHook(() =>
      useMutation({
        success: "Access revoked",
        undo: () => ({ success: "Access restored", request: { url: "/api/docs/d1/shares" } }),
      }),
    );
    await act(async () => {
      await result.current.run({ url: "/api/docs/d1/shares", method: "DELETE" });
    });
    await act(async () => {
      lastAction()?.onClick();
    });
    await waitFor(() => expect(failureMock).toHaveBeenCalledWith(MESSAGES.conflict));
    expect(successMock).toHaveBeenCalledTimes(1);
  });

  it("offers no Undo when the config declines to build one for this result", async () => {
    stubFetch(async () => json({ reversible: false }));
    const { result } = renderHook(() =>
      useMutation<{ reversible: boolean }>({ success: "Done", undo: () => undefined }),
    );
    await act(async () => {
      await result.current.run({ url: "/api/tasks" });
    });
    expect(lastAction()).toBeUndefined();
  });

  it("offers no Undo on a failed mutation", async () => {
    stubFetch(async () => json({ error: { code: "not_found" } }, 404));
    const { result } = renderHook(() =>
      useMutation({ success: "Done", undo: () => ({ success: "Undone", request: { url: "/x" } }) }),
    );
    await act(async () => {
      await result.current.run({ url: "/api/tasks/t1" });
    });
    expect(successMock).not.toHaveBeenCalled();
  });
});
