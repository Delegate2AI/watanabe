import { repoUrl } from "@/lib/repo";
import { isGitHubDotCom } from "./kind";

export function githubApiBase(): string {
  const url = new URL(repoUrl());
  return isGitHubDotCom(url.hostname) ? "https://api.github.com" : `${url.origin}/api/v3`;
}

export function githubRepoPath(): string {
  const [owner = "", repo = ""] = new URL(repoUrl()).pathname.split("/").filter(Boolean);
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo.replace(/\.git$/, ""))}`;
}

export function githubRepoApi(): string {
  return `${githubApiBase()}/repos/${githubRepoPath()}`;
}

export function githubHeaders(token: string, withBody = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "watanabe",
    ...(withBody ? { "Content-Type": "application/json" } : {}),
  };
}

export async function githubFailure(res: Response, api: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`GitHub ${api} API returned ${res.status}: ${body.slice(0, 500)}`);
}
