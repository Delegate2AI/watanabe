import { encodedProjectPath, gitlabApiBase } from "./gitlab-api";
import type {
  ChangeRequestStatus,
  CreateChangeRequestParams,
  CreateChangeRequestResult,
} from "./types";

export async function createMergeRequest(params: CreateChangeRequestParams): Promise<CreateChangeRequestResult> {
  const res = await fetch(`${gitlabApiBase()}/projects/${encodedProjectPath()}/merge_requests`, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": params.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_branch: params.sourceBranch,
      target_branch: params.targetBranch ?? "main",
      title: params.title,
      description: params.description,
      remove_source_branch: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitLab merge_requests API returned ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { web_url?: string; iid?: number };
  if (!data.web_url) {
    throw new Error("GitLab merge_requests API response was missing web_url");
  }
  return { webUrl: data.web_url, iid: typeof data.iid === "number" ? data.iid : null };
}

export async function getMergeRequest(params: { iid: number; token: string }): Promise<ChangeRequestStatus> {
  const res = await fetch(
    `${gitlabApiBase()}/projects/${encodedProjectPath()}/merge_requests/${params.iid}`,
    { headers: { "PRIVATE-TOKEN": params.token } },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitLab merge_requests API returned ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { state?: string };
  const state = data.state;
  if (state !== "opened" && state !== "merged" && state !== "closed" && state !== "locked") {
    throw new Error(`GitLab merge_requests API returned an unrecognised state: ${String(state)}`);
  }
  return { state };
}
