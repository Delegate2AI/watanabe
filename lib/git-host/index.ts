import { log } from "@/lib/log";
import { repoUrl } from "@/lib/repo";
import { createPullRequest, getPullRequestState } from "./github";
import { closePullRequest, mergePullRequest } from "./github-merge";
import { getPullRequestFiles, listOpenPullRequests } from "./github-review";
import { createMergeRequest, getMergeRequest } from "./gitlab";
import {
  closeMergeRequest,
  getMergeRequestChanges,
  listOpenMergeRequests,
  mergeMergeRequest,
} from "./gitlab-review";
import { authUsernameFor, gitHostKind } from "./kind";
import { GITHUB_TERMS, GITLAB_TERMS } from "./terms";
import type { GitHost, GitHostKind } from "./types";

export type * from "./types";

const gitlabHost: GitHost = {
  kind: "gitlab",
  terms: GITLAB_TERMS,
  authUsername: authUsernameFor("gitlab"),
  createChangeRequest: createMergeRequest,
  getChangeRequestState: getMergeRequest,
  listOpenChangeRequests: listOpenMergeRequests,
  getChangeRequestChanges: getMergeRequestChanges,
  mergeChangeRequest: mergeMergeRequest,
  closeChangeRequest: closeMergeRequest,
};

const githubHost: GitHost = {
  kind: "github",
  terms: GITHUB_TERMS,
  authUsername: authUsernameFor("github"),
  createChangeRequest: createPullRequest,
  getChangeRequestState: getPullRequestState,
  listOpenChangeRequests: listOpenPullRequests,
  getChangeRequestChanges: getPullRequestFiles,
  mergeChangeRequest: mergePullRequest,
  closeChangeRequest: closePullRequest,
};

function repoHostname(): string {
  try {
    return new URL(repoUrl()).hostname;
  } catch (error) {
    log.warn("git-host: REPO_URL is not a URL, assuming GitLab", { err: String(error) });
    return "";
  }
}

export function currentGitHostKind(): GitHostKind {
  return gitHostKind(repoHostname(), process.env.GIT_HOST);
}

export function getGitHost(): GitHost {
  return currentGitHostKind() === "github" ? githubHost : gitlabHost;
}
