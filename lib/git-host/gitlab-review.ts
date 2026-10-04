import { encodedProjectPath, gitlabApiBase } from "./gitlab-api";
import { jsonMessage } from "./json-message";
import type { ChangeRequestChanges, ChangeRequestSummary, MergeOutcome } from "./types";

const PER_PAGE = 100;
const MAX_PAGES = 20;

export async function listOpenMergeRequests(params: {
  token: string;
  targetBranch?: string;
}): Promise<ChangeRequestSummary[]> {
  const all: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      state: "opened",
      target_branch: params.targetBranch ?? "main",
      order_by: "created_at",
      sort: "desc",
      per_page: String(PER_PAGE),
      page: String(page),
    });

    const res = await fetch(
      `${gitlabApiBase()}/projects/${encodedProjectPath()}/merge_requests?${query}`,
      { headers: { "PRIVATE-TOKEN": params.token } },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitLab merge_requests API returned ${res.status}: ${body.slice(0, 500)}`);
    }

    const batch = (await res.json()) as Array<Record<string, unknown>>;
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  return all.map((mr) => ({
    iid: Number(mr.iid),
    title: String(mr.title ?? ""),
    description: String(mr.description ?? ""),
    sourceBranch: String(mr.source_branch ?? ""),
    authorName: String((mr.author as { name?: string } | undefined)?.name ?? ""),
    authorUsername: String((mr.author as { username?: string } | undefined)?.username ?? ""),
    createdAt: String(mr.created_at ?? ""),
    webUrl: String(mr.web_url ?? ""),
    sha: String(mr.sha ?? ""),
  }));
}

function isTruncated(overflow: unknown, changesCount: unknown, returned: number): boolean {
  if (overflow === true) return true;
  if (typeof changesCount === "string" && changesCount.trim().endsWith("+")) return true;
  const declared =
    typeof changesCount === "number" ? changesCount : Number.parseInt(String(changesCount ?? ""), 10);
  return Number.isFinite(declared) && declared > returned;
}

export async function getMergeRequestChanges(params: {
  iid: number;
  token: string;
}): Promise<ChangeRequestChanges> {
  const res = await fetch(
    `${gitlabApiBase()}/projects/${encodedProjectPath()}/merge_requests/${params.iid}/changes`,
    { headers: { "PRIVATE-TOKEN": params.token } },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitLab merge_request changes API returned ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    changes?: Array<Record<string, unknown>>;
    changes_count?: unknown;
    overflow?: unknown;
  };
  const changes = (data.changes ?? []).map((change) => ({
    oldPath: String(change.old_path ?? ""),
    newPath: String(change.new_path ?? ""),
    diff: String(change.diff ?? ""),
    newFile: change.new_file === true,
    deletedFile: change.deleted_file === true,
    renamedFile: change.renamed_file === true,
  }));
  return { changes, truncated: isTruncated(data.overflow, data.changes_count, changes.length) };
}

export async function mergeMergeRequest(params: {
  iid: number;
  token: string;
  sha?: string;
}): Promise<MergeOutcome> {
  const res = await fetch(
    `${gitlabApiBase()}/projects/${encodedProjectPath()}/merge_requests/${params.iid}/merge`,
    {
      method: "PUT",
      headers: {
        "PRIVATE-TOKEN": params.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        should_remove_source_branch: true,
        ...(params.sha ? { sha: params.sha } : {}),
      }),
    },
  );

  if (res.ok) {
    const merged = (await res.json().catch(() => null)) as {
      state?: unknown;
      merge_error?: unknown;
    } | null;
    if (merged?.state === "merged") return { ok: true };
    const reason =
      typeof merged?.merge_error === "string" && merged.merge_error
        ? merged.merge_error
        : `GitLab accepted the request but left it ${String(merged?.state ?? "in an unknown state")}`;
    return { ok: false, status: res.status, reason };
  }

  const body = await res.text().catch(() => "");
  return { ok: false, status: res.status, reason: jsonMessage(body) ?? body.slice(0, 300) };
}

export async function closeMergeRequest(params: { iid: number; token: string }): Promise<void> {
  const res = await fetch(
    `${gitlabApiBase()}/projects/${encodedProjectPath()}/merge_requests/${params.iid}`,
    {
      method: "PUT",
      headers: {
        "PRIVATE-TOKEN": params.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state_event: "close" }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitLab merge_requests API returned ${res.status}: ${body.slice(0, 500)}`);
  }
}
