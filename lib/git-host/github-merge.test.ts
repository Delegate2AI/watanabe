import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "@/lib/log";
import { closePullRequest, mergePullRequest } from "./github-merge";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function pull(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    state: "closed",
    head: { ref: "kb/alice/add-7", repo: { full_name: "acme/kb" } },
    base: { ref: "main", repo: { full_name: "acme/kb" } },
    ...overrides,
  };
}

let savedRepoUrl: string | undefined;

beforeEach(() => {
  savedRepoUrl = process.env.REPO_URL;
  process.env.REPO_URL = "https://github.com/acme/kb.git";
  vi.spyOn(log, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedRepoUrl === undefined) delete process.env.REPO_URL;
  else process.env.REPO_URL = savedRepoUrl;
});

describe("mergePullRequest", () => {
  it("PUTs the reviewed sha to the merge endpoint, then deletes the head branch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ merged: true, sha: "m1", message: "Pull Request successfully merged" }))
      .mockResolvedValueOnce(jsonResponse(pull()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mergePullRequest({ iid: 7, token: "ghp-abc", sha: "abc123" });

    expect(result).toEqual({ ok: true });
    const [mergeUrl, mergeInit] = fetchMock.mock.calls[0];
    expect(mergeUrl).toBe("https://api.github.com/repos/acme/kb/pulls/7/merge");
    expect(mergeInit.method).toBe("PUT");
    expect(mergeInit.headers.Authorization).toBe("Bearer ghp-abc");
    expect(JSON.parse(mergeInit.body)).toEqual({ sha: "abc123" });
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[2];
    expect(deleteUrl).toBe("https://api.github.com/repos/acme/kb/git/refs/heads/kb/alice/add-7");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("omits sha when the caller has none", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ merged: true }))
      .mockResolvedValueOnce(jsonResponse(pull()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await mergePullRequest({ iid: 7, token: "t" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("sha");
  });

  it.each([405, 409, 422])("reports a %i refusal with GitHub's message instead of throwing", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Pull Request is not mergeable" }, status));
    vi.stubGlobal("fetch", fetchMock);

    await expect(mergePullRequest({ iid: 7, token: "t", sha: "abc" })).resolves.toEqual({
      ok: false,
      status,
      reason: "Pull Request is not mergeable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw body when the refusal is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway down", { status: 502 })));
    await expect(mergePullRequest({ iid: 7, token: "t" })).resolves.toEqual({
      ok: false,
      status: 502,
      reason: "gateway down",
    });
  });

  it("refuses to call a 2xx that does not report merged a merge", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ merged: false, message: "Base branch was modified" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(mergePullRequest({ iid: 7, token: "t" })).resolves.toEqual({
      ok: false,
      status: 200,
      reason: "Base branch was modified",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays ok when deleting the head branch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ merged: true }))
        .mockResolvedValueOnce(jsonResponse(pull()))
        .mockResolvedValueOnce(jsonResponse({ message: "Reference does not exist" }, 422)),
    );
    await expect(mergePullRequest({ iid: 7, token: "t" })).resolves.toEqual({ ok: true });
  });

  it("stays ok when reading the pull after the merge throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse({ merged: true })).mockRejectedValueOnce(new Error("ECONNRESET")),
    );
    await expect(mergePullRequest({ iid: 7, token: "t" })).resolves.toEqual({ ok: true });
  });

  it("never deletes a branch that lives in a fork", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ merged: true }))
      .mockResolvedValueOnce(jsonResponse(pull({ head: { ref: "main", repo: { full_name: "mallory/kb" } } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(mergePullRequest({ iid: 7, token: "t" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("closePullRequest", () => {
  it("PATCHes state=closed, then deletes the head branch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pull()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await closePullRequest({ iid: 7, token: "ghp-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/kb/pulls/7");
    expect(init.method).toBe("PATCH");
    expect(init.headers.Authorization).toBe("Bearer ghp-abc");
    expect(JSON.parse(init.body)).toEqual({ state: "closed" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.github.com/repos/acme/kb/git/refs/heads/kb/alice/add-7");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  it("does not fail the close when the branch delete fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(jsonResponse(pull())).mockRejectedValueOnce(new Error("ECONNRESET")),
    );
    await expect(closePullRequest({ iid: 7, token: "t" })).resolves.toBeUndefined();
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));
    await expect(closePullRequest({ iid: 7, token: "t" })).rejects.toThrow(/403/);
  });
});
