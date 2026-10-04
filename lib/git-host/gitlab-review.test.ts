import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listOpenMergeRequests, mergeMergeRequest } from "./gitlab-review";

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

describe("listOpenMergeRequests", () => {
  it("asks for opened MRs against the target branch and maps the fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        [
          {
            iid: 7,
            title: "Add note",
            description: "by alice",
            source_branch: "kb/alice/add-7",
            author: { name: "Portal Bot", username: "portal-bot" },
            created_at: "2026-08-18T10:00:00Z",
            web_url: "https://gl/mr/7",
            sha: "abc123",
          },
        ],
        200,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listOpenMergeRequests({ token: "glpat-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("state=opened");
    expect(String(url)).toContain("target_branch=main");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-abc");
    expect(result).toEqual([
      {
        iid: 7,
        title: "Add note",
        description: "by alice",
        sourceBranch: "kb/alice/add-7",
        authorName: "Portal Bot",
        authorUsername: "portal-bot",
        createdAt: "2026-08-18T10:00:00Z",
        webUrl: "https://gl/mr/7",
        sha: "abc123",
      },
    ]);
  });

  it("honors an explicit targetBranch override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([], 200));
    vi.stubGlobal("fetch", fetchMock);

    await listOpenMergeRequests({ token: "glpat-abc", targetBranch: "develop" });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("target_branch=develop");
  });

  it("tolerates a merge request with fields missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{ iid: 7 }], 200)));

    await expect(listOpenMergeRequests({ token: "glpat-abc" })).resolves.toEqual([
      {
        iid: 7,
        title: "",
        description: "",
        sourceBranch: "",
        authorName: "",
        authorUsername: "",
        createdAt: "",
        webUrl: "",
        sha: "",
      },
    ]);
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(listOpenMergeRequests({ token: "glpat-abc" })).rejects.toThrow(/500/);
  });
});

describe("listOpenMergeRequests pagination", () => {
  it("keeps asking until a short page, so a proposal past the hundredth is not dropped", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ iid: i + 1, sha: "a" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(full, 200))
      .mockResolvedValueOnce(jsonResponse([{ iid: 101, sha: "b" }], 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listOpenMergeRequests({ token: "glpat-abc" });

    expect(result).toHaveLength(101);
    expect(String(fetchMock.mock.calls[0][0])).toContain("page=1");
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("stops after one request when the first page is short", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ iid: 1, sha: "a" }], 200));
    vi.stubGlobal("fetch", fetchMock);
    await listOpenMergeRequests({ token: "glpat-abc" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("mergeMergeRequest guards", () => {
  it("sends the reviewed sha, so GitLab refuses a branch that moved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ state: "merged" }, 200));
    vi.stubGlobal("fetch", fetchMock);
    await mergeMergeRequest({ iid: 7, token: "glpat-abc", sha: "abc123" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).sha).toBe("abc123");
  });

  it("omits sha entirely when the caller has none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ state: "merged" }, 200));
    vi.stubGlobal("fetch", fetchMock);
    await mergeMergeRequest({ iid: 7, token: "glpat-abc" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).not.toHaveProperty("sha");
  });

  it("refuses to call a 200 with the request still open a merge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ state: "opened", merge_error: "Branch cannot be merged" }, 200),
      ),
    );
    expect(await mergeMergeRequest({ iid: 7, token: "glpat-abc" })).toEqual({
      ok: false,
      status: 200,
      reason: "Branch cannot be merged",
    });
  });

  it("reports the state when a 200 carries no merge_error either", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ state: "locked" }, 200)));
    const result = await mergeMergeRequest({ iid: 7, token: "glpat-abc" });
    expect(result).toMatchObject({ ok: false, status: 200 });
    expect(result).toHaveProperty("reason", expect.stringContaining("locked"));
  });
});
