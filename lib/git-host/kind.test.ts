import { describe, it, expect, vi, afterEach } from "vitest";
import { log } from "@/lib/log";
import { authUsernameFor, gitHostKind } from "./kind";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gitHostKind", () => {
  it("resolves github.com and www.github.com to github", () => {
    expect(gitHostKind("github.com", undefined)).toBe("github");
    expect(gitHostKind("www.github.com", undefined)).toBe("github");
    expect(gitHostKind("GitHub.com", undefined)).toBe("github");
  });

  it("resolves gitlab.com and any other host to gitlab, today's behavior", () => {
    expect(gitHostKind("gitlab.com", undefined)).toBe("gitlab");
    expect(gitHostKind("git.example.com", undefined)).toBe("gitlab");
    expect(gitHostKind("github.example.com", undefined)).toBe("gitlab");
  });

  it("lets GIT_HOST win over the hostname in both directions", () => {
    expect(gitHostKind("github.example.com", "github")).toBe("github");
    expect(gitHostKind("github.com", "gitlab")).toBe("gitlab");
    expect(gitHostKind("git.example.com", " GitHub ")).toBe("github");
  });

  it("treats an empty GIT_HOST as unset", () => {
    expect(gitHostKind("github.com", "")).toBe("github");
    expect(gitHostKind("gitlab.com", "  ")).toBe("gitlab");
  });

  it("logs an unknown GIT_HOST and falls back to the hostname instead of throwing", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    expect(gitHostKind("github.com", "bitbucket")).toBe("github");
    expect(gitHostKind("gitlab.com", "bitbucket")).toBe("gitlab");
    expect(warn).toHaveBeenCalled();
  });
});

describe("authUsernameFor", () => {
  it("is oauth2 for gitlab and x-access-token for github", () => {
    expect(authUsernameFor("gitlab")).toBe("oauth2");
    expect(authUsernameFor("github")).toBe("x-access-token");
  });
});
