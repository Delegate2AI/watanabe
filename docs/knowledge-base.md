# Connecting and working with the knowledge base

This document explains how Watanabe connects to a git repository that holds your knowledge base, what that repository must look like, how edits travel back as reviewable change requests, how the review queue and the memory branch work, and how the vault is indexed and searched. For environment variable listings see [`.env.example`](../.env.example) and [`portal.example.yaml`](../portal.example.yaml). For system context see [architecture.md](./architecture.md).

## Concepts

| Term | Meaning |
| --- | --- |
| knowledge base (KB) | The git repository plus its vault. |
| vault | The markdown directory inside the repository (`repo.vaultSubdir`, default `docs`), which the app reads from a checkout. |
| change request | A GitLab merge request or a GitHub pull request. The UI says "MR" or "PR" depending on the git host. |
| managed checkout | A clone the app creates and refreshes itself, used when a read token is configured. |
| worktree | A short-lived `git worktree` where one chat thread (or one publish action) stages edits before they are committed. |

The following guarantees shape everything below. The live checkout that readers see is never edited in place: every edit is made in a separate worktree. Knowledge base edits are never force-pushed, and in the default `mr` write mode they are never merged by the app itself: a person with the approve capability merges them in the review queue or on the git host.

## Repository layout expectations

### Branch

The default branch must be named `main`. The code hardcodes it: the managed checkout clones `--branch main`, refreshes with `git fetch --depth 1 origin main`, worktrees are created from `origin/main`, and change requests target `main` (`../lib/repo.ts`, `../lib/repo-write.ts`, `../lib/git-host/types.ts`).

### Vault directory

`VAULT_SUBDIR` (environment) takes precedence over `repo.vaultSubdir` (`portal.yaml`). The default is `docs`. An empty string or `.` means the repository root is the vault. Presence is tested rather than truthiness, so `VAULT_SUBDIR=""` is meaningful (`../lib/repo.ts`, `resolveVaultRoot`).

```yaml
repo:
  vaultSubdir: docs
```

The review queue is stricter than the rest of the app. It only treats paths under the literal prefix `docs/` as vault paths (`VAULT_PREFIX` in `../lib/review/clearance.ts`), so a change request is listed only when the vault directory is named `docs`. Deployments that use another `vaultSubdir` should expect the in-app review queue to list nothing and should review on the git host instead.

### Markdown files

- Notes are `.md` files. The native KB view renders `.md` pages only, and routes are extensionless: a request for `team/handbook` resolves to `team/handbook.md` (`../lib/vault.ts`).
- Frontmatter is a leading `---` block of YAML. The generated index reads `title`, `description` and `tags`. A missing title falls back to the first `# heading` in the body, then to the filename with `-` and `_` turned into spaces. A missing description falls back to the first non-heading line, capped at 200 characters (`../lib/index/frontmatter.ts`).
- The `visibility` frontmatter field decides clearance. It may be a string or a list of group names. A note with no `visibility` is `all-hands`. A note whose frontmatter block cannot be parsed is treated as unparseable and is visible to admins only (`../lib/authority/visibility.ts`, `../lib/authority/projection.ts`).
- The landing page of the KB view is `README.md`, then `INDEX.md`, at the vault root (`findRootLandingDoc` in `../lib/vault.ts`).
- Relative links to other `.md` files (`../other/note.md#heading`) are rewritten to in-app routes. A leading `/` resolves from the vault root. Absolute URLs, `mailto:` links and pure `#anchor` links are left alone. When a page is rendered, a link that climbs above the vault root is clamped to the vault root and rewritten to an in-app route. The clamped route can still resolve to an existing note (for example `../README.md` from the vault root becomes `/README`). The separate path-resolution helper used for moving notes rejects such links instead (`../lib/vault-links.ts`).

### Ignored paths

| Path | Effect |
| --- | --- |
| Any path segment beginning with `.` | Hidden from the KB view and from the generated index. |
| `private`, `templates` | Hidden from the KB view and from the agent's read and write tools. |
| `assets/source`, `assets/data` | Hidden from the KB view and from the agent's tools. |
| `.obsidian`, `.git`, `.claude`, `.harness`, `.authority`, `node_modules` | Hidden from the agent's tools (`IGNORED_PATTERNS` in `../lib/kb-mcp/constants.ts`). |
| `memory` and a root `INDEX.md` | Additionally excluded from the generated index. |
| `meetings` | Readable everywhere, writable by nobody through the write tools. The meetings subsystem owns it (`SYSTEM_WRITE_DENY`). |

### Assets

Non-markdown files (images, PDFs) are served by `GET /api/kb/asset/<vault-relative path>` with the requester's clearance applied. Markdown is never served by that route. When group clearance is enabled, a per-clearance projection of the vault carries markdown plus only the assets that some visible note references through a markdown link, an image embed or a wiki link (`../lib/authority/assets.ts`). An asset that no visible note references is absent for that reader.

The write tools refuse to write files with known binary extensions (`.png`, `.pdf`, `.zip`, `.xlsx`, and others listed in `KNOWN_BINARY_EXTENSIONS` in `../lib/kb-mcp/paths.ts`). The vault is a plain-text store from the write path's point of view. Add binary assets through your normal git workflow.

## Managed checkout or a local checkout

| | Managed checkout | Local checkout |
| --- | --- | --- |
| Selected when | `REPO_READ_TOKEN` is set | `LOCAL_REPO_PATH` (or `repo.path`) is set and `REPO_READ_TOKEN` is unset |
| Location | `REPO_CHECKOUT_DIR`, default `/data/repo` | The path you give, resolved against the process working directory |
| Clone and refresh | The app clones and refreshes it | The app does nothing; it logs that clone and refresh are skipped |
| Intended for | Real deployments | Local evaluation and development |

If both are present the managed checkout wins. That rule is deliberate: a config file naming a path cannot disable clone-on-boot in a real deployment. `LOCAL_REPO_PATH` beats `repo.path` when both are set (`localDevPath` in `../lib/repo.ts`, `../lib/config/load.ts`).

The managed checkout is disposable. Each refresh runs `git remote set-url origin`, `git fetch --depth 1 origin main`, then `git reset --hard origin/main`, so nothing local survives. The clone is shallow. When writes are enabled (`KB_WRITE_ENABLED=1`), boot runs a one-time `git fetch --unshallow` because `git rebase` needs history.

Using a local checkout together with writes works only if the checkout has an `origin` remote and `REPO_URL` is set. The write path runs `git fetch origin main` and `git worktree add` inside your checkout and pushes to a URL built from `REPO_URL`.

Readiness: `GET /api/ready` reports whether the vault directory exists and is non-empty (alongside database and credential checks). `GET /api/health` always answers `{"status":"ok"}`.

### Background refresh

The managed checkout is refreshed in these situations:

| Trigger | Condition | Notes |
| --- | --- | --- |
| Boot | `REPO_URL` and `REPO_READ_TOKEN` set | `instrumentation.ts` calls `refreshRepo()` once at startup. |
| Interval | `KB_WRITE_ENABLED=1` | A timer every `REPO_REFRESH_INTERVAL_MS`, default 300000 ms. It also reconciles artifacts waiting on review. A read-only deployment (writes off) has no interval timer. |
| Push webhook | `REPO_REFRESH_WEBHOOK_SECRET` set | `POST /api/repo/refresh` with header `x-gitlab-token: <secret>`. Unset secret gives 501, wrong token gives 401, both with an empty body. |
| Scheduled job | `CRON_SECRET` set | `POST /api/cron/repo-refresh` with header `x-cron-secret`. See [architecture.md](./architecture.md#background-jobs). |
| After a direct commit or a review merge | Automatic | The app refreshes right after its own push or merge. |

The webhook route reads only the `x-gitlab-token` header. Nothing in it checks a GitHub signature header, so on GitHub use the interval or the scheduled job to pick up merges that happen on the host.

After a webhook, the app also rebuilds the index (when `INDEX_ENABLED`), clears the link-graph cache, and reconciles artifacts waiting on review. `refreshRepo()` never throws: a failure is logged with the token redacted and the app keeps serving what is already on disk.

## Connecting a git host

### Selecting the host

`GIT_HOST` accepts `gitlab` or `github`. When it is unset, a `REPO_URL` host of `github.com` or `www.github.com` selects GitHub and every other host selects GitLab. An unrecognized `GIT_HOST` value is ignored with a warning and the host is inferred. GitHub Enterprise Server needs `GIT_HOST=github` explicitly (`../lib/git-host/kind.ts`).

`REPO_URL` must be an HTTPS clone URL. Git over HTTPS authenticates with the token as the password and a fixed username: `oauth2` for GitLab and `x-access-token` for GitHub.

```bash
REPO_URL=https://gitlab.example.com/your-org/your-knowledge-base.git
REPO_READ_TOKEN=...
REPO_WRITE_TOKEN=...
```

### Two tokens

| Variable | Used for |
| --- | --- |
| `REPO_READ_TOKEN` | Clone and fetch of the managed checkout, and the unshallow fetch. Setting it also switches off `LOCAL_REPO_PATH`. |
| `REPO_WRITE_TOKEN` | Everything else that touches the host: pushing branches, change request API calls, the review queue, the memory branch, and artifact reconciliation. Writes need it, and the memory branch needs it even when `KB_WRITE_ENABLED` is off. |

When `REPO_WRITE_TOKEN` is missing, the write tools return an error, the review queue returns an empty list, and the review decision route answers `write_unavailable`.

### GitLab setup

The API base is `<origin of REPO_URL>/api/v4`, and the project is the whole URL path without `.git` (so subgroups work). Because only the origin is used, a GitLab instance served under a path prefix is not supported by this code. Requests carry the token in a `PRIVATE-TOKEN` header, so a personal, project or group access token works.

API calls the app makes (all with `REPO_WRITE_TOKEN`):

| Operation | Call | Where |
| --- | --- | --- |
| Open a change request | `POST /projects/:id/merge_requests` with `source_branch`, `target_branch`, `title`, `description`, `remove_source_branch: true` | `../lib/git-host/gitlab.ts` |
| Read a change request's state | `GET /projects/:id/merge_requests/:iid` | same |
| List open change requests | `GET /projects/:id/merge_requests?state=opened&target_branch=main&order_by=created_at&sort=desc&per_page=100&page=N`, up to 20 pages | `../lib/git-host/gitlab-review.ts` |
| Read the diff | `GET /projects/:id/merge_requests/:iid/changes` | same |
| Merge | `PUT /projects/:id/merge_requests/:iid/merge` with `should_remove_source_branch: true` and the reviewed `sha` | same |
| Close | `PUT /projects/:id/merge_requests/:iid` with `state_event: close` | same |

Git over HTTPS: `git clone`, `git fetch` and `git reset` with the read token, and `git push` of `HEAD:refs/heads/<branch>` with the write token.

What that implies for tokens (standard GitLab scopes for these calls, not read from this repository):

| Token | Scopes | Role on the project |
| --- | --- | --- |
| Read | `read_repository` | Reporter or higher, enough to clone. |
| Write | `api` (the merge request calls) and `write_repository` (push) | Developer can push branches and open merge requests. Merging into a protected `main` needs a role that the branch protection allows to merge, typically Maintainer. |

Webhook (optional): in the project, add a webhook for push events pointing at `https://<your-host>/api/repo/refresh` with the secret token set to `REPO_REFRESH_WEBHOOK_SECRET`.

### GitHub setup

The API base is `https://api.github.com` for `github.com` and `<origin of REPO_URL>/api/v3` for any other host, which is the GitHub Enterprise Server layout. The repository is the first two path segments of `REPO_URL` (`owner/repo`, `.git` stripped). Requests send `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28` (`../lib/git-host/github-api.ts`).

```bash
GIT_HOST=github
REPO_URL=https://github.example.com/your-org/your-knowledge-base.git
```

API calls the app makes (all with `REPO_WRITE_TOKEN`):

| Operation | Call | Where |
| --- | --- | --- |
| Open a change request | `POST /repos/{owner}/{repo}/pulls` with `title`, `head`, `base`, `body` | `../lib/git-host/github.ts` |
| Read a change request's state | `GET /repos/{owner}/{repo}/pulls/{n}` (`open`, or `closed` split into merged and closed by `merged_at`) | same |
| List open change requests | `GET /pulls?state=open&base=main&sort=created&direction=desc&per_page=100&page=N`, up to 20 pages | `../lib/git-host/github-review.ts` |
| Read the diff | `GET /pulls/{n}/files`, paged at 100 up to a 3000 file ceiling | same |
| Merge | `PUT /pulls/{n}/merge` with the reviewed `sha`; no merge method is specified | `../lib/git-host/github-merge.ts` |
| Close | `PATCH /pulls/{n}` with `state: closed` | same |
| Delete the head branch after merge or close (best effort, same-repository branches only) | `GET /pulls/{n}` when needed, then `DELETE /git/refs/heads/{branch}`; a failure is logged and ignored | same |

Git over HTTPS uses the `x-access-token` username with the token as password.

What that implies for tokens (standard GitHub permissions for these calls, not read from this repository):

| Token | Fine-grained permissions | Classic scope |
| --- | --- | --- |
| Read | Contents: read | `repo` for private repositories |
| Write | Contents: read and write (push, delete branch ref) and Pull requests: read and write (create, list, read files, merge, close) | `repo` |

Branch protection on `main` still applies to the merge call. A refused merge surfaces as described under [Review queue](#review-queue).

## The write path

Writes are switched on by the feature flag `KB_WRITE_ENABLED` (a restart is needed for startup-only steps such as the boot sweep of orphaned worktrees; the permission gate and tool registration read the current value) plus `REPO_WRITE_TOKEN`. With writes off, the agent has no write tools at all: they are not registered and the permission gate denies them too (`../lib/authority/write-gate.ts`, `../lib/kb-mcp/server.ts`, `../lib/agent/permissions.ts`).

### End to end

1. **Worktree.** The first staging call in a chat thread runs `git fetch origin main` and `git worktree add --detach <WORKTREE_ROOT>/<thread id> origin/main`. `WORKTREE_ROOT` defaults to `/data/worktrees`. The thread id is validated against `^[a-zA-Z0-9_-]+$` before it becomes a path segment. The worktree is keyed by the thread, so a draft survives the warm session being evicted and resumed. Calls for one thread are serialized by an in-process lock.
2. **Staging.** The agent edits through `kb_stage_edit` (full file content), `kb_stage_delete`, and `kb_stage_move`. Each path is resolved against the worktree's vault directory. Containment, the ignore list and the system-owned list (`meetings`) are all checked, and symlinks are followed before the check so a link cannot redirect a write. Nothing outside the vault directory can be staged because `kb_submit` only runs `git add -A` scoped to the vault directory.
3. **Review of the draft.** `kb_diff` shows `git diff --cached` scoped to the vault. `kb_check` runs the integrity check. When the quality gates flag is on, `kb_stage_edit` also rejects an edit whose added lines trip the mechanical writing checks and restores the file to its previous staged content. `kb_discard` removes the worktree.
4. **Confirmation.** `kb_submit` is the only tool that pushes. The permission gate returns "confirm" for it, which pauses the turn and asks the thread owner in the chat UI. The owner can allow or deny, and an unanswered request is denied after 10 minutes (`../lib/agent/session-permissions.ts`).
5. **Authorization.** In `mr` mode the submitter needs the `write` capability. In `direct` mode they need `approve`. If roles are not enabled (`ROLES_ENABLED` off), everyone has both. A denial reads `Permission denied: mr submission requires the editor role or higher.` (or `direct` and `approver`).
6. **Commit.** The commit message comes from the agent and the author is the contributor (`--author "<name> <email>"`). The committer is the portal bot, set per invocation with `-c user.name` and `-c user.email`. The defaults are `Watanabe Portal Bot` and `portal-bot@watanabe.local`, configurable under `git.botName` and `git.botEmail` in `portal.yaml`.
7. **Rebase and push.** The worktree is rebased onto a freshly fetched `origin/main`. A rebase conflict is retried once with a new fetch, then reported back with the conflicting file names and the worktree is left intact. The push never uses `--force`.
8. **Change request.** In `mr` mode the branch is `kb/<sanitized author email>/<slug>-<timestamp in ms>` (the email lowercased with runs of other characters turned into `-`; the slug must match `^[a-z0-9-]+$`). The app pushes `HEAD:refs/heads/<branch>` with the write token, then opens the change request through the host adapter. The title is the first line of the commit message (capped at 255 characters) and the description is the rest of the message plus an attribution line. The description is sanitized so a commit body cannot open with a quick action.
9. **Cleanup.** After a successful push the worktree is removed. At boot, with writes enabled, orphaned worktree directories and stale registrations are swept.

### Direct mode

`KB_WRITE_MODE=direct` pushes straight to `main` instead of opening a change request. Two other paths also land content on the default branch without a second person, independently of `KB_WRITE_MODE`: meeting note ingestion always commits directly, and publishing a shared document can select direct mode per request (for submitters with the `approve` capability). The push is fast-forward only (no `--force`): if `main` moved, the app re-fetches, re-rebases and pushes once more. Direct mode needs the `approve` capability. The remote MCP surface (`/api/mcp`) always forces `mr`, and `kb_submit` escalates to `mr` for one submission when the integrity check flags duplicate or contradicting content. Note deletion proposals and the re-clearance job always use `mr` regardless of `KB_WRITE_MODE`. Single-note visibility changes follow `KB_WRITE_MODE`.

After a direct commit through the agent tools or a direct publish, the app refreshes the managed checkout, rebuilds the index and clears the graph cache. Meeting ingestion and direct visibility edits do not do this themselves, so they rely on the webhook or the scheduled refresh.

### Who else uses the same path

Publishing artifacts and shared documents to the KB, update packages, meeting note ingestion (which commits directly), note deletion (`POST /api/kb/delete`, admin only, `KB_DELETE_ENABLED`), and visibility changes all go through the same worktree, `submit` and change request code (`../lib/kb-write/`, `../lib/repo-write.ts`). Publishing to an existing note keeps that note's frontmatter, so a publish cannot rewrite its clearance.

### Allow-listed paths

The write path is confined to the vault directory at the tool layer, not by prompt. A path must resolve inside the thread worktree's vault directory, outside the ignore list, outside `meetings/`, and outside any symlink that leads elsewhere. The agent's generic file tools (Edit, Write and similar) are denied outright, and its read tools are confined to the vault root and the thread's attachment directory (`../lib/agent/permissions.ts`). The one exception to "vault only" is the memory branch described below, which is written by separate code with its own allow-list.

## Review queue

The queue lets an approver merge or close proposals without leaving the app. It is behind `KB_REVIEW_ENABLED` (off means the routes answer 404 and approvers review on the git host). It reads the host with `REPO_WRITE_TOKEN`.

### Listing

`GET /api/review` requires the `approve` capability and returns `{ proposals }`. For each open change request targeting `main`:

1. The diff is read. If the host reports it truncated, the change request is skipped and a warning is logged (`review: merge request diff was truncated by GitLab`). A diff the host truncated cannot be checked for which paths it touches, so such a change request must be reviewed on the host. GitLab truncation is detected from `overflow`, a `changes_count` ending in `+`, or a count larger than the returned list. GitHub truncation is detected from a patch missing on a text change or from reaching the 3000 file ceiling.
2. A change request whose diff cannot be read is skipped without emptying the whole queue.
3. Every touched path must be under `docs/` (a rename must qualify at both ends), and the requester must be cleared for every note in it. One note outside the requester's clearance hides the whole proposal. Admins see all.
4. Each proposal is enriched with the origin (`artifact`, `shared-doc` or `chat`) and proposer from the database when a publish row exists, otherwise from the attribution line in the description.

If the host cannot be listed at all the route answers `review_unavailable` (HTTP 502) so an outage does not look like an empty queue.

### Approve, reject

`POST /api/review/<iid>` with `{"action":"approve","sha":"<head sha shown>"}` or `{"action":"reject"}`. Every gate is re-derived on the server: flag, `approve` capability, a configured write token, and the proposal's own clearance (a missing proposal and an uncleared one both answer `not_cleared`, so the queue is not an oracle). Before deciding, the app refreshes the checkout so clearance is judged on current content.

- **Reject** closes the change request. On GitHub the head branch is then deleted on a best-effort basis.
- **Approve** requires the `sha` of the head commit the reviewer was shown (a missing `sha` is HTTP 400). If the branch head no longer matches it, the app answers `conflict` (HTTP 409) with detail `stale_head` and merges nothing. Otherwise it merges with the reviewer's `sha`, so the host also refuses the merge if the branch moves in between. Reject does not need a `sha`. On GitLab the merge asks the host to remove the source branch. A refusal returns `conflict` (HTTP 409) and the host's reason is written to the log only.

After a merge the app refreshes the checkout, rebuilds the index, clears the graph cache and reconciles artifacts waiting on review. Every decision is appended to an audit table naming the deciding person, because the host attributes the merge to the token's owner. Approving one's own proposal is recorded with a `selfApproval` flag but is not blocked by the app. If your policy forbids it, enforce it with branch protection on the host.

## The memory branch

Memory and the access files live on a separate orphan branch named `portal-memory` in the same repository. It is never merged to `main`.

| Item | Detail |
| --- | --- |
| Flag | `MEMORY_ENABLED`, independent of `KB_WRITE_ENABLED`. Needs `REPO_WRITE_TOKEN` to push. |
| Checkout | `MEMORY_CHECKOUT_DIR`, default `/data/memory`. A shallow clone of the branch. |
| Remote override | `MEMORY_ORIGIN_OVERRIDE` replaces the remote URL, otherwise it is built from `REPO_URL` and the write token. |
| Bootstrap | At boot: if the remote has the branch, clone it; if not, clone the default branch, create an orphan `portal-memory`, seed `memory/CLAUDE.md` and `memory/shared/all-hands/MEMORY.md`, and push. An existing checkout is fetched and `reset --hard FETCH_HEAD`. |
| Layout | `memory/CLAUDE.md` (governance), `memory/shared/<group>/` (team memory per group), `memory/users/<email slug>/` (per person). |
| Commits | Authored by `Portal Memory <git.memoryEmail>` (default `portal-memory@watanabe.local`) with a `Memory-For: <email>` trailer. Each commit fetches, rebases onto the remote branch and pushes without force. A failed rebase is aborted so the next attempt starts clean. |
| Access files | `access/groups.yaml`, `roles.yaml`, `flags.yaml`, `people.yaml`, `aliases.yaml`, `connectors.yaml`, `skills.yaml` and `design-guide.md` are read from and committed to this branch by the admin features. The writer accepts only those eight paths, refuses symlinks, and requires the `manageAccess` capability. |

Chat sessions may read memory and never write it. Memory is written by a server-side consolidation process that runs with a restricted tool list and path checks scoped to the owner's subtree and the groups they are cleared for (`../lib/memory/scope.ts`, `../lib/memory/dream.ts`).

Treat this branch as application state. Repository admins may want to protect it from deletion and keep it out of any public mirror, since it holds group membership and role files.

## Indexing and search

### Generated index

With `INDEX_ENABLED` on, the app scans the vault and builds a map of every `.md` document grouped by top-level directory (titles and descriptions as described above). The map is held in memory and mirrored to `INDEX_CACHE_DIR/index.json` (default `/data/index`) so a fresh process can serve the last good index. It powers the `kb_index` agent tool and can be committed as `INDEX.md` through the write path on request. Rebuild never throws: on failure it keeps the last good index.

The index is rebuilt at boot, after a direct commit through the agent tools or a direct publish, after a review merge, and after the push webhook. The interval refresh and the `repo-refresh` job do not rebuild it, so with neither a webhook nor merges through the app the index can lag until the next boot. When group clearance is enabled, `kb_index` builds a fresh index for the caller's clearance root instead of using the cache. After a write submission, if a committed `INDEX.md` differs from a fresh render, the agent reports it as stale.

### Search

There is no search server. Search is a case-insensitive substring scan over the files the caller can see:

- `kb_search` (agent tool) scans line by line, up to 5000 files, and stops at 50 matching lines.
- The KB search page re-checks matches against the note body and parsed title, so a note that only lists a name in frontmatter does not match, and it builds snippets from rendered text (`../lib/kb/search.ts`).
- The command palette (`../lib/search/global.ts`) searches the KB in the same way, together with chats, artifacts, shared docs, meetings, tasks and people, each limited to what the caller owns or is cleared for and to six results per group.
- `kb_read` refuses files over 1 MiB and binary files. `kb_list` returns at most 2000 entries when listing recursively; a nonrecursive listing of one directory is not capped.

### Link graph

With `KB_GRAPH_ENABLED`, the KB view shows a link graph and backlinks built from the vault's links. It is cached per clearance root for 5 minutes. The cache is cleared explicitly after a direct commit through the agent tools, a direct publish, a review decision that merges, and a repository webhook refresh. The startup and scheduled checkout refreshes do not clear it, so it expires on its TTL there.

### Clearance

With `AUTHORITY_ENABLED`, reads are served from a per-clearance copy of the vault under `AUTHORITY_PROJECTION_DIR` (default `/data/authority`), containing only notes the reader's groups may see. A note outside a reader's clearance is physically absent from their copy, so a search or a path guess cannot find it. Copies are rebuilt when the vault revision or the access files change.

## Troubleshooting

Messages below are quoted from the source. Where the source message continues after a dash, only the part before the dash is quoted.

| Message or symptom | Cause and fix |
| --- | --- |
| `[repo] REPO_URL is not set and there is no local checkout` | Neither a managed nor a local checkout is configured. Set `REPO_URL` and `REPO_READ_TOKEN`, or `LOCAL_REPO_PATH`. |
| `[repo] REPO_READ_TOKEN is not set` | `REPO_URL` is set but there is no read token and no local path. The app serves whatever already exists at the checkout directory. |
| `[repo] Failed to clone/refresh docs repo at <dir>: ...` | The git command failed (bad token, wrong URL, no network, no `git` in the image). The token is redacted in the message. The app keeps serving the previous content. |
| `[repo] LOCAL_REPO_PATH is set` | Informational. Clone and refresh are skipped. If you expected a managed checkout, unset `LOCAL_REPO_PATH` and set `REPO_READ_TOKEN`. |
| `[repo] Failed to unshallow <dir>: ...` | The one-time unshallow fetch failed. It later shows up as a rebase conflict error on submit. |
| `/api/ready` reports the knowledge base missing | The vault directory does not exist or is empty. Check `VAULT_SUBDIR`, and that the checkout contains files under it. |
| `git-host: unknown GIT_HOST, inferring from the repository host` | `GIT_HOST` is not `gitlab` or `github`. Fix the value. |
| `git-host: REPO_URL is not a URL, assuming GitLab` | `REPO_URL` does not parse as a URL. |
| `GitLab merge_requests API returned 401: ...` or `GitHub pulls API returned 403: ...` | The write token is missing a scope or permission, or lacks access to the repository. The first 500 characters of the host's response follow the status. See the token tables above. |
| `GitLab merge_request changes API returned ...` | The diff read failed for a change request. That change request is skipped in the queue. |
| `GitHub pulls API response was missing html_url` or `GitLab merge_requests API response was missing web_url` | The host answered 2xx without a link. Check the host and any proxy in between. |
| `GitHub accepted the request but did not report it merged` | GitHub returned success without `merged: true`. Merge on the host. |
| `Write mode is not enabled for this knowledge-base assistant` | `KB_WRITE_ENABLED` is off. The agent is read only. |
| `Write mode is misconfigured on this deployment (no write credential)` | `REPO_WRITE_TOKEN` is unset. |
| `Permission denied: mr submission requires the editor role or higher.` | The submitter lacks the capability. Grant the role in `access/roles.yaml`, or see `ROLES_ENABLED`. |
| `isn't a valid slug` | The branch slug contains characters other than lowercase letters, digits and hyphens. The agent should retry with a valid slug. |
| `Could not submit: ...` | A git step failed. The text after the colon is the git error with the token redacted. A `nothing staged` message means no edit was made. |
| `This edit conflicts with a more recent change to the knowledge base in: <files>` | The rebase onto `origin/main` conflicted. The staged edit is preserved. Ask the contributor how to resolve it. |
| `Pushed branch "<branch>" successfully, but opening the Merge Request failed` (or `Pull Request`) | The push worked and the change request call failed. The branch is on the remote, so open the change request by hand or fix the token and retry. |
| `"meetings/" is maintained by the meetings subsystem and is not editable here` | The path is system owned. |
| `Path "<path>" resolves outside the knowledge-base vault, refusing to access it.` | A path escapes the vault, directly or through a symlink. |
| `Path "<path>" is inside an ignored area of the knowledge-base vault, refusing to access it.` | The path is under `private`, `templates`, a dot directory, `assets/source` or `assets/data`. |
| `"<path>" looks like a binary file` | The write path refuses binary extensions. |
| `refusing to build a worktree path from an unsafe thread id` | A thread id contained characters outside letters, digits, `_` and `-`. |
| Publishing is unavailable: this deployment has no write access to the knowledge base. | The `write_unavailable` message (HTTP 503). `KB_WRITE_ENABLED` is off or `REPO_WRITE_TOKEN` is unset. |
| Your change was saved to a branch, but the request to review it could not be opened. | The `review_unavailable` message (HTTP 502). The branch is pushed. Open the change request on the host. |
| `You need editor access to do that. Ask an admin.` | The `needs_role` message (HTTP 403). |
| Review queue is empty though change requests exist | `KB_REVIEW_ENABLED` is off, `REPO_WRITE_TOKEN` is unset, the diff was truncated, the change request touches paths outside `docs/`, or you are not cleared for every note in it. |
| `POST /api/repo/refresh` returns 501 or 401 | Status 501 means `REPO_REFRESH_WEBHOOK_SECRET` is unset. Status 401 means the `x-gitlab-token` header is missing or wrong. |
| `[instrumentation] portal-memory worktree unavailable` or `[memory] ensureMemoryWorktree failed` | The memory branch could not be cloned or seeded. Check `REPO_WRITE_TOKEN` and permission to create branches. `REPO_WRITE_TOKEN is required to push portal-memory` means the token is unset. |
