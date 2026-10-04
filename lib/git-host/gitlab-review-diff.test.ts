import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { closeMergeRequest, getMergeRequestChanges, mergeMergeRequest } from "./gitlab-review";

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let savedRepoUrl: string | undefined;

beforeEach(() => {
  savedRepoUrl = process.env.REPO_URL;
  process.env.REPO_URL = "https://gitlab.com/acme/team/kb-docs.git";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedRepoUrl === undefined) delete process.env.REPO_URL;
  else process.env.REPO_URL = savedRepoUrl;
});

describe("getMergeRequestChanges", () => {
  it("GETs the iid's changes and maps the changes array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          changes: [
            {
              old_path: "docs/a.md",
              new_path: "docs/a.md",
              diff: "@@ -1 +1 @@\n-a\n+b\n",
              new_file: false,
              deleted_file: false,
              renamed_file: false,
            },
          ],
        },
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMergeRequestChanges({ iid: 7, token: "glpat-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/merge_requests/7/changes");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-abc");
    expect(result).toEqual({
      truncated: false,
      changes: [
        {
          oldPath: "docs/a.md",
          newPath: "docs/a.md",
          diff: "@@ -1 +1 @@\n-a\n+b\n",
          newFile: false,
          deletedFile: false,
          renamedFile: false,
        },
      ],
    });
  });

  it("returns an empty list when the response carries no changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 200)));
    await expect(getMergeRequestChanges({ iid: 7, token: "glpat-abc" })).resolves.toEqual({
      changes: [],
      truncated: false,
    });
  });

  it("reports a diff GitLab flagged as overflowing as truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ changes: [], overflow: true }, 200)),
    );
    const result = await getMergeRequestChanges({ iid: 7, token: "glpat-abc" });
    expect(result.truncated).toBe(true);
  });

  it("reports a capped changes_count like \"20+\" as truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ changes: [], changes_count: "20+" }, 200)),
    );
    const result = await getMergeRequestChanges({ iid: 7, token: "glpat-abc" });
    expect(result.truncated).toBe(true);
  });

  it("reports a changes_count higher than the list it returned as truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            changes: [{ old_path: "docs/a.md", new_path: "docs/a.md", diff: "" }],
            changes_count: "3",
          },
          200,
        ),
      ),
    );
    const result = await getMergeRequestChanges({ iid: 7, token: "glpat-abc" });
    expect(result.truncated).toBe(true);
  });

  it("is not truncated when the count matches what it returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            changes: [{ old_path: "docs/a.md", new_path: "docs/a.md", diff: "" }],
            changes_count: "1",
          },
          200,
        ),
      ),
    );
    const result = await getMergeRequestChanges({ iid: 7, token: "glpat-abc" });
    expect(result.truncated).toBe(false);
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    await expect(getMergeRequestChanges({ iid: 7, token: "glpat-abc" })).rejects.toThrow(/404/);
  });
});

describe("mergeMergeRequest", () => {
  it("PUTs to the merge endpoint and returns ok on a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ state: "merged" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await mergeMergeRequest({ iid: 7, token: "glpat-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/merge_requests/7/merge");
    expect(init.method).toBe("PUT");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-abc");
    expect(result).toEqual({ ok: true });
  });

  it("reports GitLab's refusal instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Branch cannot be merged" }, 405)),
    );

    await expect(mergeMergeRequest({ iid: 7, token: "glpat-abc" })).resolves.toEqual({
      ok: false,
      status: 405,
      reason: "Branch cannot be merged",
    });
  });

  it("falls back to the raw body when the refusal is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway down", { status: 502 })));

    await expect(mergeMergeRequest({ iid: 7, token: "glpat-abc" })).resolves.toEqual({
      ok: false,
      status: 502,
      reason: "gateway down",
    });
  });
});

describe("closeMergeRequest", () => {
  it("PUTs state_event=close to the iid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal("fetch", fetchMock);

    await closeMergeRequest({ iid: 7, token: "glpat-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/merge_requests/7");
    expect(init.method).toBe("PUT");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-abc");
    expect(JSON.parse(init.body)).toEqual({ state_event: "close" });
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 403 })));
    await expect(closeMergeRequest({ iid: 7, token: "glpat-abc" })).rejects.toThrow(/403/);
  });
});
