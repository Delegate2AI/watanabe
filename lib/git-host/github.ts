import { githubFailure, githubHeaders, githubRepoApi } from "./github-api";
import type {
  ChangeRequestRef,
  ChangeRequestStatus,
  CreateChangeRequestParams,
  CreateChangeRequestResult,
} from "./types";

export async function createPullRequest(params: CreateChangeRequestParams): Promise<CreateChangeRequestResult> {
  const res = await fetch(`${githubRepoApi()}/pulls`, {
    method: "POST",
    headers: githubHeaders(params.token, true),
    body: JSON.stringify({
      title: params.title,
      head: params.sourceBranch,
      base: params.targetBranch ?? "main",
      body: params.description,
    }),
  });

  if (!res.ok) throw await githubFailure(res, "pulls");

  const data = (await res.json()) as { html_url?: string; number?: number };
  if (!data.html_url) {
    throw new Error("GitHub pulls API response was missing html_url");
  }
  return { webUrl: data.html_url, iid: typeof data.number === "number" ? data.number : null };
}

export async function getPullRequestState(params: ChangeRequestRef): Promise<ChangeRequestStatus> {
  const res = await fetch(`${githubRepoApi()}/pulls/${params.iid}`, { headers: githubHeaders(params.token) });

  if (!res.ok) throw await githubFailure(res, "pulls");

  const data = (await res.json()) as { state?: string; merged_at?: string | null };
  if (data.state === "open") return { state: "opened" };
  if (data.state === "closed") return { state: data.merged_at ? "merged" : "closed" };
  throw new Error(`GitHub pulls API returned an unrecognised state: ${String(data.state)}`);
}
