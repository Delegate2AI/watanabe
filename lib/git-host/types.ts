export type GitHostKind = "gitlab" | "github";

export interface ChangeRequestTerms {
  short: "MR" | "PR";
  long: "merge request" | "pull request";
}

export interface CreateChangeRequestParams {
  sourceBranch: string;
  targetBranch?: string;
  title: string;
  description: string;
  token: string;
}

export interface CreateChangeRequestResult {
  webUrl: string;
  iid: number | null;
}

export type ChangeRequestState = "opened" | "merged" | "closed" | "locked";

export interface ChangeRequestStatus {
  state: ChangeRequestState;
}

export interface ChangeRequestSummary {
  iid: number;
  title: string;
  description: string;
  sourceBranch: string;
  authorName: string;
  authorUsername: string;
  createdAt: string;
  webUrl: string;
  sha: string;
}

export interface ChangedPath {
  oldPath: string;
  newPath: string;
  diff: string;
  newFile: boolean;
  deletedFile: boolean;
  renamedFile: boolean;
}

export interface ChangeRequestChanges {
  changes: ChangedPath[];
  truncated: boolean;
}

export type MergeOutcome = { ok: true } | { ok: false; status: number; reason: string };

export interface ChangeRequestRef {
  iid: number;
  token: string;
}

export interface GitHost {
  kind: GitHostKind;
  terms: ChangeRequestTerms;
  authUsername: string;
  createChangeRequest(params: CreateChangeRequestParams): Promise<CreateChangeRequestResult>;
  getChangeRequestState(params: ChangeRequestRef): Promise<ChangeRequestStatus>;
  listOpenChangeRequests(params: { token: string; targetBranch?: string }): Promise<ChangeRequestSummary[]>;
  getChangeRequestChanges(params: ChangeRequestRef): Promise<ChangeRequestChanges>;
  mergeChangeRequest(params: ChangeRequestRef & { sha?: string }): Promise<MergeOutcome>;
  closeChangeRequest(params: ChangeRequestRef): Promise<void>;
}
