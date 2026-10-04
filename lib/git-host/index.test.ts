import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "@/lib/log";
import { getGitHost } from "./index";

let savedRepoUrl: string | undefined;
let savedGitHost: string | undefined;

beforeEach(() => {
  savedRepoUrl = process.env.REPO_URL;
  savedGitHost = process.env.GIT_HOST;
  delete process.env.GIT_HOST;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedRepoUrl === undefined) delete process.env.REPO_URL;
  else process.env.REPO_URL = savedRepoUrl;
  if (savedGitHost === undefined) delete process.env.GIT_HOST;
  else process.env.GIT_HOST = savedGitHost;
});

describe("getGitHost", () => {
  it("picks GitLab for a gitlab.com REPO_URL, with merge request terms", () => {
    process.env.REPO_URL = "https://gitlab.com/grp/proj.git";
    const host = getGitHost();
    expect(host.kind).toBe("gitlab");
    expect(host.terms).toEqual({ short: "MR", long: "merge request" });
    expect(host.authUsername).toBe("oauth2");
  });

  it("picks GitLab for a self-hosted REPO_URL", () => {
    process.env.REPO_URL = "https://git.example.com/grp/proj.git";
    expect(getGitHost().kind).toBe("gitlab");
  });

  it("picks GitHub for a github.com REPO_URL, with pull request terms", () => {
    process.env.REPO_URL = "https://github.com/acme/kb.git";
    const host = getGitHost();
    expect(host.kind).toBe("github");
    expect(host.terms).toEqual({ short: "PR", long: "pull request" });
    expect(host.authUsername).toBe("x-access-token");
  });

  it("lets GIT_HOST=github select GitHub for an Enterprise host", () => {
    process.env.REPO_URL = "https://ghe.example.com/acme/kb.git";
    process.env.GIT_HOST = "github";
    expect(getGitHost().kind).toBe("github");
  });

  it("lets GIT_HOST=gitlab override a github.com host", () => {
    process.env.REPO_URL = "https://github.com/acme/kb.git";
    process.env.GIT_HOST = "gitlab";
    expect(getGitHost().kind).toBe("gitlab");
  });

  it("falls back to the hostname on an unknown GIT_HOST", () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    process.env.REPO_URL = "https://github.com/acme/kb.git";
    process.env.GIT_HOST = "gitea";
    expect(getGitHost().kind).toBe("github");
  });

  it("falls back to GitLab instead of throwing when REPO_URL is not a URL", () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    process.env.REPO_URL = "not a url";
    expect(getGitHost().kind).toBe("gitlab");
  });
});
