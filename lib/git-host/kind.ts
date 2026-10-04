import { log } from "@/lib/log";
import type { GitHostKind } from "./types";

const GITHUB_HOSTNAMES = new Set(["github.com", "www.github.com"]);

function isGitHostKind(value: string): value is GitHostKind {
  return value === "gitlab" || value === "github";
}

export function isGitHubDotCom(hostname: string): boolean {
  return GITHUB_HOSTNAMES.has(hostname.toLowerCase());
}

export function gitHostKind(hostname: string, gitHostEnv: string | undefined): GitHostKind {
  const requested = gitHostEnv?.trim().toLowerCase() ?? "";
  if (isGitHostKind(requested)) return requested;
  if (requested) {
    log.warn("git-host: unknown GIT_HOST, inferring from the repository host", { gitHost: requested });
  }
  return isGitHubDotCom(hostname) ? "github" : "gitlab";
}

export function authUsernameFor(kind: GitHostKind): string {
  return kind === "github" ? "x-access-token" : "oauth2";
}
