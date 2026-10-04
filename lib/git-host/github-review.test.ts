import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getPullRequestFiles, listOpenPullRequests } from "./github-review";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let savedRepoUrl: string | undefined;

beforeEach(() => {
  savedRepoUrl = process.env.REPO_URL;
  process.env.REPO_URL = "https://github.com/acme/kb.git";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (savedRepoUrl === undefined) delete process.env.REPO_URL;
  else process.env.REPO_URL = savedRepoUrl;
});

describe("listOpenPullRequests", () => {
  it("asks for open pulls against the target branch, newest first, and maps the fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          number: 7,
          title: "Add note",
          body: "by alice",
          head: { ref: "kb/alice/add-7", sha: "abc123" },
          user: { login: "portal-bot" },
          created_at: "2026-10-04T10:00:00Z",
          html_url: "https://github.com/acme/kb/pull/7",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listOpenPullRequests({ token: "ghp-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe("https://api.github.com/repos/acme/kb/pulls");
    expect(parsed.searchParams.get("state")).toBe("open");
    expect(parsed.searchParams.get("base")).toBe("main");
    expect(parsed.searchParams.get("sort")).toBe("created");
    expect(parsed.searchParams.get("direction")).toBe("desc");
    expect(init.headers.Authorization).toBe("Bearer ghp-abc");
    expect(result).toEqual([
      {
        iid: 7,
        title: "Add note",
        description: "by alice",
        sourceBranch: "kb/alice/add-7",
        authorName: "portal-bot",
        authorUsername: "portal-bot",
        createdAt: "2026-10-04T10:00:00Z",
        webUrl: "https://github.com/acme/kb/pull/7",
        sha: "abc123",
      },
    ]);
  });

  it("prefers the author's name when the API carries one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse([{ number: 1, user: { login: "alice", name: "Alice A" } }])),
    );
    const [mr] = await listOpenPullRequests({ token: "t" });
    expect(mr.authorName).toBe("Alice A");
    expect(mr.authorUsername).toBe("alice");
  });

  it("tolerates a null body and a null user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([{ number: 7, body: null, user: null }])));
    await expect(listOpenPullRequests({ token: "t" })).resolves.toEqual([
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

  it("honors an explicit targetBranch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await listOpenPullRequests({ token: "t", targetBranch: "develop" });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("base")).toBe("develop");
  });

  it("keeps asking until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(full))
      .mockResolvedValueOnce(jsonResponse([{ number: 101 }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listOpenPullRequests({ token: "t" });

    expect(result).toHaveLength(101);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("page")).toBe("1");
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("page")).toBe("2");
  });

  it("stops at the 20-page backstop even when every page is full", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: i + 1 }));
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(full));
    vi.stubGlobal("fetch", fetchMock);

    const result = await listOpenPullRequests({ token: "t" });

    expect(fetchMock).toHaveBeenCalledTimes(20);
    expect(result).toHaveLength(2000);
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(listOpenPullRequests({ token: "t" })).rejects.toThrow(/500/);
  });
});

function file(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { filename: "docs/a.md", status: "modified", changes: 2, patch: "@@ -1 +1 @@\n-a\n+b", ...overrides };
}

describe("getPullRequestFiles", () => {
  it("GETs the pull's files and maps them onto ChangedPath", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        file(),
        file({ filename: "docs/new.md", status: "added", patch: "@@ -0,0 +1 @@\n+x" }),
        file({ filename: "docs/gone.md", status: "removed", patch: "@@ -1 +0,0 @@\n-x" }),
        file({ filename: "docs/b.md", previous_filename: "docs/old-b.md", status: "renamed", changes: 0, patch: undefined }),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestFiles({ iid: 7, token: "ghp-abc" });

    const parsed = new URL(String(fetchMock.mock.calls[0][0]));
    expect(parsed.pathname).toBe("/repos/acme/kb/pulls/7/files");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer ghp-abc");
    expect(result).toEqual({
      truncated: false,
      changes: [
        { oldPath: "docs/a.md", newPath: "docs/a.md", diff: "@@ -1 +1 @@\n-a\n+b", newFile: false, deletedFile: false, renamedFile: false },
        { oldPath: "docs/new.md", newPath: "docs/new.md", diff: "@@ -0,0 +1 @@\n+x", newFile: true, deletedFile: false, renamedFile: false },
        { oldPath: "docs/gone.md", newPath: "docs/gone.md", diff: "@@ -1 +0,0 @@\n-x", newFile: false, deletedFile: true, renamedFile: false },
        { oldPath: "docs/old-b.md", newPath: "docs/b.md", diff: "", newFile: false, deletedFile: false, renamedFile: true },
      ],
    });
  });

  it("pages through the file list until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => file({ filename: `docs/${i}.md` }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(full))
      .mockResolvedValueOnce(jsonResponse([file({ filename: "docs/last.md" })]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestFiles({ iid: 7, token: "t" });

    expect(result.changes).toHaveLength(101);
    expect(result.truncated).toBe(false);
  });

  it("is truncated when the list reaches GitHub's 3000-file ceiling", async () => {
    const full = Array.from({ length: 100 }, (_, i) => file({ filename: `docs/${i}.md` }));
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(full));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPullRequestFiles({ iid: 7, token: "t" });

    expect(fetchMock).toHaveBeenCalledTimes(30);
    expect(result.truncated).toBe(true);
  });

  it("is truncated when a file with line changes comes back without a patch (diff too large to return)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([file({ changes: 5000, patch: undefined })])));
    const result = await getPullRequestFiles({ iid: 7, token: "t" });
    expect(result.truncated).toBe(true);
  });

  it("is not truncated by a file with zero line changes and no patch (binary or pure rename)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse([file({ filename: "docs/img.png", status: "added", changes: 0, patch: undefined })])),
    );
    const result = await getPullRequestFiles({ iid: 7, token: "t" });
    expect(result).toEqual({
      truncated: false,
      changes: [{ oldPath: "docs/img.png", newPath: "docs/img.png", diff: "", newFile: true, deletedFile: false, renamedFile: false }],
    });
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    await expect(getPullRequestFiles({ iid: 7, token: "t" })).rejects.toThrow(/404/);
  });
});
