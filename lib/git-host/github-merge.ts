import { log } from "@/lib/log";
import { githubFailure, githubHeaders, githubRepoApi } from "./github-api";
import { jsonMessage } from "./json-message";
import type { ChangeRequestRef, MergeOutcome } from "./types";

type Json = Record<string, unknown>;

function nested(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    current = current && typeof current === "object" ? (current as Json)[key] : undefined;
  }
  return current;
}

function sameRepoHeadBranch(pull: unknown): string | null {
  const ref = nested(pull, "head", "ref");
  const headRepo = nested(pull, "head", "repo", "full_name");
  const baseRepo = nested(pull, "base", "repo", "full_name");
  if (typeof ref !== "string" || !ref) return null;
  if (typeof headRepo !== "string" || typeof baseRepo !== "string") return null;
  return headRepo.toLowerCase() === baseRepo.toLowerCase() ? ref : null;
}

async function deleteHeadBranch(pull: unknown, iid: number, token: string): Promise<void> {
  const branch = sameRepoHeadBranch(pull);
  if (!branch) return;
  const ref = branch.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${githubRepoApi()}/git/refs/heads/${ref}`, {
    method: "DELETE",
    headers: githubHeaders(token),
  });
  if (!res.ok) {
    log.warn("git-host: could not delete the pull request's head branch", { iid, status: res.status });
  }
}

async function deleteHeadBranchBestEffort(iid: number, token: string, pull?: unknown): Promise<void> {
  try {
    let known = pull;
    if (known === undefined) {
      const res = await fetch(`${githubRepoApi()}/pulls/${iid}`, { headers: githubHeaders(token) });
      if (!res.ok) {
        log.warn("git-host: could not read the pull request to delete its branch", { iid, status: res.status });
        return;
      }
      known = await res.json();
    }
    await deleteHeadBranch(known, iid, token);
  } catch (error) {
    log.warn("git-host: could not delete the pull request's head branch", { iid, err: String(error) });
  }
}

export async function mergePullRequest(params: ChangeRequestRef & { sha?: string }): Promise<MergeOutcome> {
  const res = await fetch(`${githubRepoApi()}/pulls/${params.iid}/merge`, {
    method: "PUT",
    headers: githubHeaders(params.token, true),
    body: JSON.stringify(params.sha ? { sha: params.sha } : {}),
  });

  if (res.ok) {
    const merged = (await res.json().catch(() => null)) as { merged?: unknown; message?: unknown } | null;
    if (merged?.merged !== true) {
      const reason =
        typeof merged?.message === "string" && merged.message
          ? merged.message
          : "GitHub accepted the request but did not report it merged";
      return { ok: false, status: res.status, reason };
    }
    await deleteHeadBranchBestEffort(params.iid, params.token);
    return { ok: true };
  }

  const body = await res.text().catch(() => "");
  return { ok: false, status: res.status, reason: jsonMessage(body) ?? body.slice(0, 300) };
}

export async function closePullRequest(params: ChangeRequestRef): Promise<void> {
  const res = await fetch(`${githubRepoApi()}/pulls/${params.iid}`, {
    method: "PATCH",
    headers: githubHeaders(params.token, true),
    body: JSON.stringify({ state: "closed" }),
  });

  if (!res.ok) throw await githubFailure(res, "pulls");

  const closed = await res.json().catch(() => null);
  await deleteHeadBranchBestEffort(params.iid, params.token, closed ?? undefined);
}
