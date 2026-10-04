import { githubFailure, githubHeaders, githubRepoApi } from "./github-api";
import type { ChangedPath, ChangeRequestChanges, ChangeRequestRef, ChangeRequestSummary } from "./types";

const PER_PAGE = 100;
const MAX_PAGES = 20;
const FILES_CEILING = 3000;

type Json = Record<string, unknown>;

async function getPage(path: string, query: Record<string, string>, token: string, page: number): Promise<Json[]> {
  const search = new URLSearchParams({ ...query, per_page: String(PER_PAGE), page: String(page) });
  const res = await fetch(`${githubRepoApi()}${path}?${search}`, { headers: githubHeaders(token) });
  if (!res.ok) throw await githubFailure(res, "pulls");
  return (await res.json()) as Json[];
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Json)[key] : undefined;
}

export async function listOpenPullRequests(params: {
  token: string;
  targetBranch?: string;
}): Promise<ChangeRequestSummary[]> {
  const query = {
    state: "open",
    base: params.targetBranch ?? "main",
    sort: "created",
    direction: "desc",
  };
  const all: Json[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await getPage("/pulls", query, params.token, page);
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  return all.map((pr) => {
    const login = String(field(pr.user, "login") ?? "");
    return {
      iid: Number(pr.number),
      title: String(pr.title ?? ""),
      description: String(pr.body ?? ""),
      sourceBranch: String(field(pr.head, "ref") ?? ""),
      authorName: String(field(pr.user, "name") || login),
      authorUsername: login,
      createdAt: String(pr.created_at ?? ""),
      webUrl: String(pr.html_url ?? ""),
      sha: String(field(pr.head, "sha") ?? ""),
    };
  });
}

function toChangedPath(file: Json): ChangedPath {
  const newPath = String(file.filename ?? "");
  return {
    oldPath: String(file.previous_filename ?? newPath),
    newPath,
    diff: typeof file.patch === "string" ? file.patch : "",
    newFile: file.status === "added",
    deletedFile: file.status === "removed",
    renamedFile: file.status === "renamed",
  };
}

function isTextChangeWithoutPatch(file: Json): boolean {
  return typeof file.patch !== "string" && Number(file.changes ?? 0) > 0;
}

export async function getPullRequestFiles(params: ChangeRequestRef): Promise<ChangeRequestChanges> {
  const files: Json[] = [];
  for (let page = 1; page <= FILES_CEILING / PER_PAGE; page += 1) {
    const batch = await getPage(`/pulls/${params.iid}/files`, {}, params.token, page);
    files.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  const truncated = files.length >= FILES_CEILING || files.some(isTextChangeWithoutPatch);
  return { changes: files.map(toChangedPath), truncated };
}
