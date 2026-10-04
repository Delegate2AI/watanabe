import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMergeRequest,
  getMergeRequest,
} from "./gitlab";

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

describe("createMergeRequest", () => {
  it("POSTs to the URL-encoded project path derived from REPO_URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://gitlab.com/mr/1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createMergeRequest({
      sourceBranch: "kb/alice/add-page-123",
      title: "Add a page",
      description: "desc",
      token: "glpat-abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fteam%2Fkb-docs/merge_requests",
    );
  });

  it("POSTs to the project path of the REPO_URL env override when set", async () => {
    process.env.REPO_URL = "https://gitlab.com/acme/team/kb-marketing.git";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://gitlab.com/mr/1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createMergeRequest({
      sourceBranch: "kb/alice/add-page-123",
      title: "Add a page",
      description: "desc",
      token: "glpat-abc",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://gitlab.com/api/v4/projects/acme%2Fteam%2Fkb-marketing/merge_requests",
    );
  });

  it("derives the API base from a self-hosted REPO_URL's origin", async () => {
    process.env.REPO_URL = "https://git.example.com/grp/proj.git";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://git.example.com/mr/1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createMergeRequest({
      sourceBranch: "kb/alice/x",
      title: "t",
      description: "d",
      token: "glpat-abc",
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://git.example.com/api/v4/projects/grp%2Fproj/merge_requests");
  });

  it("sends PRIVATE-TOKEN auth and the expected JSON body, defaulting target_branch to main", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://gitlab.com/mr/1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createMergeRequest({
      sourceBranch: "kb/alice/add-page-123",
      title: "Add a page",
      description: "desc",
      token: "glpat-abc",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-abc");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      source_branch: "kb/alice/add-page-123",
      target_branch: "main",
      title: "Add a page",
      description: "desc",
      remove_source_branch: true,
    });
  });

  it("honors an explicit targetBranch override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://gitlab.com/mr/1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createMergeRequest({
      sourceBranch: "kb/alice/x",
      targetBranch: "develop",
      title: "t",
      description: "d",
      token: "glpat-abc",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).target_branch).toBe("develop");
  });

  it("returns the webUrl from a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://gitlab.com/acme/team/kb-docs/-/merge_requests/42" })),
    );

    const result = await createMergeRequest({
      sourceBranch: "kb/alice/x",
      title: "t",
      description: "d",
      token: "glpat-abc",
    });

    expect(result).toEqual({
      webUrl: "https://gitlab.com/acme/team/kb-docs/-/merge_requests/42",
      iid: null,
    });
  });

  it("throws with the status and body on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("permission denied", { status: 403 })));

    await expect(
      createMergeRequest({ sourceBranch: "kb/alice/x", title: "t", description: "d", token: "bad-token" }),
    ).rejects.toThrow(/403/);
  });

  it("throws when the response is missing web_url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: 1 })));

    await expect(
      createMergeRequest({ sourceBranch: "kb/alice/x", title: "t", description: "d", token: "glpat-abc" }),
    ).rejects.toThrow(/web_url/);
  });

  it("returns the iid alongside the webUrl", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://gl/mr/42", iid: 42 })));

    const result = await createMergeRequest({
      sourceBranch: "kb/alice/x",
      title: "t",
      description: "d",
      token: "glpat-abc",
    });

    expect(result).toEqual({ webUrl: "https://gl/mr/42", iid: 42 });
  });

  it("does not throw when the response omits iid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ web_url: "https://gl/mr/42" })));

    await expect(
      createMergeRequest({ sourceBranch: "kb/alice/x", title: "t", description: "d", token: "glpat-abc" }),
    ).resolves.toEqual({ webUrl: "https://gl/mr/42", iid: null });
  });
});

describe("getMergeRequest", () => {
  it("GETs the iid under the encoded project path with PRIVATE-TOKEN auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ state: "merged" }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMergeRequest({ iid: 42, token: "glpat-abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/merge_requests/42");
    expect(init.headers["PRIVATE-TOKEN"]).toBe("glpat-abc");
    expect(result).toEqual({ state: "merged" });
  });

  it.each(["opened", "merged", "closed", "locked"] as const)("passes through the %s state", async (state) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ state }, 200)));
    await expect(getMergeRequest({ iid: 1, token: "t" })).resolves.toEqual({ state });
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    await expect(getMergeRequest({ iid: 1, token: "t" })).rejects.toThrow(/404/);
  });

  it("throws on a state it does not recognise", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ state: "sorcery" }, 200)));
    await expect(getMergeRequest({ iid: 1, token: "t" })).rejects.toThrow(/unrecognised state/);
  });
});
