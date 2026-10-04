import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPullRequest, getPullRequestState } from "./github";
import { githubApiBase, githubRepoPath } from "./github-api";

function jsonResponse(body: unknown, status = 201): Response {
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

describe("githubApiBase", () => {
  it("is api.github.com for a github.com repository", () => {
    expect(githubApiBase()).toBe("https://api.github.com");
  });

  it("is <origin>/api/v3 for a GitHub Enterprise repository", () => {
    process.env.REPO_URL = "https://ghe.example.com/acme/kb.git";
    expect(githubApiBase()).toBe("https://ghe.example.com/api/v3");
  });

  it("parses owner and repo from REPO_URL, with or without .git", () => {
    expect(githubRepoPath()).toBe("acme/kb");
    process.env.REPO_URL = "https://github.com/acme/kb";
    expect(githubRepoPath()).toBe("acme/kb");
  });
});

describe("createPullRequest", () => {
  const params = { sourceBranch: "kb/alice/x", title: "Add a page", description: "desc", token: "ghp-abc" };

  it("POSTs to the pulls endpoint with GitHub's headers and body, defaulting base to main", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ html_url: "https://github.com/acme/kb/pull/5", number: 5 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPullRequest(params);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/kb/pulls");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer ghp-abc");
    expect(init.headers.Accept).toBe("application/vnd.github+json");
    expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(JSON.parse(init.body)).toEqual({ title: "Add a page", head: "kb/alice/x", base: "main", body: "desc" });
    expect(result).toEqual({ webUrl: "https://github.com/acme/kb/pull/5", iid: 5 });
  });

  it("uses the Enterprise API base for a GHE repository", async () => {
    process.env.REPO_URL = "https://ghe.example.com/acme/kb.git";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ html_url: "https://ghe.example.com/acme/kb/pull/1", number: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await createPullRequest(params);
    expect(fetchMock.mock.calls[0][0]).toBe("https://ghe.example.com/api/v3/repos/acme/kb/pulls");
  });

  it("honors an explicit targetBranch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ html_url: "u", number: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await createPullRequest({ ...params, targetBranch: "develop" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).base).toBe("develop");
  });

  it("returns a null iid rather than throwing when number is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ html_url: "u" })));
    await expect(createPullRequest(params)).resolves.toEqual({ webUrl: "u", iid: null });
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Validation Failed", { status: 422 })));
    await expect(createPullRequest(params)).rejects.toThrow(/422/);
  });

  it("throws when the response is missing html_url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ number: 1 })));
    await expect(createPullRequest(params)).rejects.toThrow(/html_url/);
  });
});

describe("getPullRequestState", () => {
  it("GETs the pull by number with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ state: "open", merged_at: null }, 200));
    vi.stubGlobal("fetch", fetchMock);
    await getPullRequestState({ iid: 42, token: "ghp-abc" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/acme/kb/pulls/42");
    expect(init.headers.Authorization).toBe("Bearer ghp-abc");
  });

  it("maps open to opened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ state: "open", merged_at: null }, 200)));
    await expect(getPullRequestState({ iid: 1, token: "t" })).resolves.toEqual({ state: "opened" });
  });

  it("maps closed with merged_at to merged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ state: "closed", merged_at: "2026-10-04T10:00:00Z" }, 200)),
    );
    await expect(getPullRequestState({ iid: 1, token: "t" })).resolves.toEqual({ state: "merged" });
  });

  it("maps closed without merged_at to closed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ state: "closed", merged_at: null }, 200)));
    await expect(getPullRequestState({ iid: 1, token: "t" })).resolves.toEqual({ state: "closed" });
  });

  it("throws on a state it does not recognise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ state: "sorcery" }, 200)));
    await expect(getPullRequestState({ iid: 1, token: "t" })).rejects.toThrow(/unrecognised state/);
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })));
    await expect(getPullRequestState({ iid: 1, token: "t" })).rejects.toThrow(/404/);
  });
});
