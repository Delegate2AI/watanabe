# Architecture

This document describes how Watanabe is put together for operators and contributors: the runtime components, what a chat turn does from request to tool call, where state lives on disk, how background jobs run, how the database migrates at boot, and the rules that govern writes to the knowledge base. For connecting a git repository see [knowledge-base.md](./knowledge-base.md). For setup see [`../README.md`](../README.md), and for authentication modes see [oidc-auth-mode.md](./oidc-auth-mode.md).

## Components

Watanabe is one Node.js process (a Next.js 16 App Router application, `nodejs` runtime, TypeScript) plus on-disk state and optional sidecar containers.

```text
                         browser (chat, KB view, review, admin)
                                      |
                                      v
   +--------------------------------------------------------------------+
   |  Next.js server (node server.js, port 3100)                        |
   |                                                                    |
   |   app/(app)/*  pages        app/api/*  route handlers              |
   |            |                        |                              |
   |            +-----------+------------+                              |
   |                        v                                           |
   |   lib/auth (identity)  lib/agent (sessions, permission gate)       |
   |   lib/authority (roles, groups, flags)    lib/jobs (cron, queues)  |
   |            |                  |                       |            |
   |            v                  v                       v            |
   |     SQLite (portal.db)   Claude Agent SDK       instrumentation.ts |
   |     better-sqlite3       subprocess per         (boot tasks,       |
   |                          warm session           refresh timer)     |
   |                               |                                    |
   |                               v                                    |
   |                    in-process MCP servers                          |
   |                    kb, mem, tasks, doc, ...                        |
   +-------+------------------------+-----------------------+-----------+
           |                        |                       |
           v                        v                       v
   managed checkout          worktrees per thread     memory worktree
   REPO_CHECKOUT_DIR         WORKTREE_ROOT            MEMORY_CHECKOUT_DIR
   (read path, vault)        (write path, staging)    (portal-memory branch)
           \                        |                       /
            +-----------------------+----------------------+
                                    |
                                    v
                    git host: GitLab or GitHub (HTTPS)
                    clone/push + change request API

   optional sidecars, reached over HTTP:
     doc-render (PDF and HTML export)   dictation-whisper (speech to text)
     llm-gate (personal LLM keys and budgets in front of an LLM gateway)
```

| Component | What it is | Where |
| --- | --- | --- |
| Next.js app | UI pages and JSON or NDJSON route handlers. Built with `output: "standalone"` and started with `node server.js`. | `../app/`, `../next.config.ts` |
| SQLite | One embedded database for threads, ownership, documents, tasks, projects, artifacts, shared docs, review decisions, job runs and more. Opened through `better-sqlite3` with WAL. | `../lib/db/` |
| Managed checkout | A shallow clone of the knowledge base repository that all reads are served from. | `../lib/repo.ts` |
| Worktrees | One `git worktree` per chat thread (or publish action) used to stage edits. | `../lib/repo-write.ts` |
| Memory worktree | A checkout of the orphan `portal-memory` branch holding memory and the access files. | `../lib/memory/` |
| Agent SDK sessions | One `@anthropic-ai/claude-agent-sdk` `query()` per warm chat session, backed by a native CLI subprocess. | `../lib/agent/` |
| In-process MCP servers | Tool servers the agent talks to, built per session. The `kb` server is always present. | `../lib/kb-mcp/` and others |
| Sidecars (optional) | Separate containers for PDF rendering, dictation and LLM key gating. | `../scripts/` |

The application keeps in-process state (warm session map, per-thread locks, job queues, the `/api/mcp` session map, index and graph caches) and is written to run as a single instance with a single persistent volume. A comment in the write path states the single-replica assumption (`../lib/repo-write.ts`). Do not run several replicas against the same volume.

## Repository layout

| Path | Contents |
| --- | --- |
| `../app/(app)/` | Authenticated pages: `chat`, `kb`, `review`, `projects`, `tasks`, `meetings`, `artifacts`, `docs`, `connectors`, `people`, `map`, `skills`, `settings`, `admin`. |
| `../app/api/` | Route handlers. Notable groups: `agent` (chat turns, permission answers, interrupt, draft, memory), `kb`, `review`, `repo/refresh`, `cron/[job]`, `mcp`, `oauth`, `auth`, `health`, `ready`, `docs`, `projects`, `tasks`, `webhooks`, `internal/llm`. |
| `../app/login`, `../app/embed`, `../app/oauth`, `../app/docs/shared` | Sign-in page, an embeddable chat page (framed under the `embed.frameAncestors` content security policy), the OAuth authorize page, and the page for documents shared by link. |
| `../lib/agent/` | Session loop, system prompts, the permission gate, Bash policy, model options. |
| `../lib/db/` | `openDb`, migration runner and migrations, one module per table family. |
| `../lib/jobs/` | Job registry, dispatch, per-family queues, run state. |
| `../lib/kb-mcp/` | The `kb` MCP server and its tools. |
| `../lib/config/` | `portal.yaml` schema and loader, feature flag registry. |
| `../lib/git-host/` | GitLab and GitHub adapters behind one `GitHost` interface. |
| `../scripts/` | Sidecars (`doc-render`, `dictation-whisper`, `llm-gate`), the `job.ts` CLI, and demo seeders (`seed-demo.ts`, `seed/`). |

## Request flow for a chat turn

1. **Request.** The browser sends `POST /api/agent` with the message and optionally a `sessionId`, context chips, connectors and a document binding. The route resolves the caller with `requireIdentity` (a strategy per `auth.mode`: `proxy-header`, `jwt`, `none` or `oidc`) and answers 401 if there is no identity (`../app/api/agent/route.ts`, `../lib/auth/identity.ts`).
2. **Ownership.** When resuming a session, `isOwnedBy` must hold, otherwise the route answers `not_cleared`. A session is never resumed on someone else's behalf.
3. **Session.** `resumeOrGetSession` or `createFreshSession` returns an `AgentSession`. Warm sessions are kept in an in-memory map keyed by SDK session id, capped at `AGENT_MAX_WARM_SESSIONS` (default 50) with least-recently-used eviction, and each has a 6 hour idle timer. Eviction only drops the subprocess: the SDK persists the transcript, so the next message resumes it (`../lib/agent/session-registry.ts`, `../lib/agent/session.ts`).
4. **Options.** `buildOptions` assembles the SDK options for the session (`../lib/agent/config.ts`):
   - `cwd` is the vault root for the owner's clearance (`vaultRootFor(clearance)`), so the agent starts inside a copy of the vault it is allowed to see.
   - `settingSources: []`, so no repository `CLAUDE.md` or settings file steers the session. The system prompt is the SDK's `claude_code` preset with the portal's instructions appended (`../lib/agent/prompts.ts`), plus memory and connector context when those features are on. When `PROJECTS_ENABLED` is on and a thread is filed into a project, the project's context is added to the prompt when the thread's session is resumed or adopted.
   - `mcpServers` always contains `kb`, and adds `mem`, `doc`, `tasks`, `copilot`, `content` and external connector servers depending on feature flags and the caller's grants.
   - `maxBudgetUsd` (`AGENT_MAX_BUDGET_USD`, default 2.0) and `maxTurns` (`AGENT_MAX_TURNS`, default 40) cap one conversation.
   - A `PreToolUse` hook and a `canUseTool` callback, both owned by the session's permission broker.
   - `env` from `resolveAgentEnv`: which credential the subprocess uses (`AGENT_AUTH_MODE`, `AGENT_CHAT_API_KEY`, `AGENT_CHAT_OAUTH_TOKEN`; see `../lib/agent/auth.ts`).
5. **Streaming.** The route returns `application/x-ndjson`: one JSON event per line (`session`, text and tool events, `permission_request`, `turn_result`, `error`). The stream closes on `turn_result` or `error`. If the browser disconnects the session stays warm.
6. **Tool permission gating.** Before every tool call the SDK runs the `PreToolUse` hook, which calls `gateAgentTool` (`../lib/agent/permissions.ts`). The gate is deny by default and returns `allow`, `deny` or `confirm`. `allowedTools` is only an auto-approve fast path and is not the boundary. The checks run in this order:
   - `mcp__mem__*`: memory read tools only, and only when memory is enabled. Chat can never write memory.
   - `mcp__tasks__*` and `mcp__doc__*`: one specific tool each, when its feature is enabled.
   - Other in-process servers and external connector tools: decided by their own gates and the per-thread connector grants.
   - The `kb` write tools (`kb_stage_edit`, `kb_stage_delete`, `kb_stage_move`, `kb_diff`, `kb_check`, `kb_discard`, `kb_submit`): denied unless `KB_WRITE_ENABLED` is on and the owner can write. `kb_submit` returns `confirm`, the others `allow`.
   - `Bash`: routed through a tiered command policy (`../lib/agent/bash-policy.ts`), never a flat allow.
   - `Skill`: allowed only for the skills materialized for this caller.
   - Everything else must be in the allow-list (`Read`, `Glob`, `Grep`, `TodoWrite`, `WebSearch`, `WebFetch`, and the read-only `kb_*` tools). `Read`, `Glob` and `Grep` additionally must target a path inside the session's vault root or the thread's attachment directory, or the call is denied.
   A denial is returned to the model with a reason so it can explain the limit to the user instead of retrying.
7. **Confirmation.** A `confirm` verdict becomes the SDK's "ask" decision, which calls `canUseTool`. The broker broadcasts a `permission_request` event (with advisory quality findings when quality gates are on) and holds the call open. The browser answers with `POST /api/agent/permission` carrying `sessionId`, `requestId` and a decision. That route checks ownership first. An unanswered request is denied after 10 minutes (`../lib/agent/session-permissions.ts`).
8. **Tool execution.** Allowed `kb_*` calls run inside the process against the vault or a thread worktree. A confirmed `kb_submit` commits, pushes and opens a change request, as described under [Write-path doctrine](#write-path-doctrine).
9. **After the turn.** The `turn_result` event carries cost and duration. When the memory feature is on, an evicted thread is consolidated into memory in the background, and `POST /api/agent/memory/end` lets a user trigger it explicitly.

Other entry points reach the same vault tools: `POST/GET/DELETE /api/mcp` exposes MCP over Streamable HTTP when `MCP_ENABLED` is on. A bearer token (portal-issued or issued by the app's own OAuth server) or the SSO cookie authenticates it, and the credential class decides which tools are registered.

## Where state lives on disk

Every path below is controlled by an environment variable. Relative values are resolved against the process working directory. In the container image, defaults point under `/data`, so mount one persistent volume there. The two exceptions with a working-directory default are the database and the skills store.

| Variable | Default | Holds |
| --- | --- | --- |
| `PORTAL_DB_PATH` | `<cwd>/.data/portal.db` | The SQLite database (plus its `-wal` and `-shm` files). Set it to a path on the volume, for example `/data/portal.db`. |
| `REPO_CHECKOUT_DIR` | `/data/repo` | Managed clone of the knowledge base repository. Disposable, reset on every refresh. |
| `LOCAL_REPO_PATH` or `repo.path` | unset | A local checkout used instead of the managed clone, only when `REPO_READ_TOKEN` is unset. |
| `VAULT_SUBDIR` or `repo.vaultSubdir` | `docs` | Not a path on disk by itself: the vault directory inside the checkout. |
| `WORKTREE_ROOT` | `/data/worktrees` | One `git worktree` per thread or publish action. |
| `MEMORY_CHECKOUT_DIR` | `/data/memory` | The `portal-memory` branch checkout: memory files and the `access/*.yaml` files. |
| `AUTHORITY_PROJECTION_DIR` | `/data/authority` | Per-clearance copies of the vault, built when group clearance is on. Regenerable. |
| `INDEX_CACHE_DIR` | `/data/index` | `index.json`, the generated vault index cache. Regenerable. |
| `CLAUDE_CONFIG_DIR` | `/data/claude` in the image, otherwise the SDK falls back to `~/.claude` | Agent SDK session transcripts. Losing it loses resumable conversations. |
| `PROJECT_DOCS_DIR` | `/data/project-docs` | Project document storage. |
| `DOC_RENDERS_DIR` | `/data/renders` | Rendered document exports. |
| `PACKAGES_DATA_DIR` | `/data/packages` | Uploaded update packages. |
| `ATTACHMENTS_DIR` | `/data/attachments` | Chat attachments. |
| `PORTAL_SKILLS_DIR` | `<cwd>/.data/skills` | Installed skills. A sibling directory named `<dir name>-materialized` holds per-clearance plugin directories, which must stay on the same mount because they symlink into the store. |
| `PORTAL_CONFIG` | `./portal.yaml` when present | The YAML configuration file. Not state, but the file the process reads at boot. |
| `DEMO_VAULT_DIR` | `.data/demo-vault` | Used only by the `scripts/seed-demo.ts` demo seeder. |

Placed on the volume, these keep conversations, database rows and the checkout across restarts. Set `PORTAL_DB_PATH` and `PORTAL_SKILLS_DIR` explicitly in containers, because their defaults would otherwise land in the container's ephemeral filesystem under the working directory. The Compose file does this for the database (`../docker-compose.yml`).

The Dockerfile builds in two stages on `node:22-slim`, installs `git` and `ca-certificates` in the runtime stage (the app shells out to `git`), runs as uid 1001, listens on `PORT` 3100 and copies `portal.yaml` into the image (an empty file when the repository has none). The Compose file includes a one-shot `data-init` container that `chown`s the volume to uid 1001 (`../Dockerfile`, `../docker-compose.yml`).

## Boot sequence

`instrumentation.ts` runs `register()` once per server instance in the Node.js runtime, before requests are served:

1. Load and validate `portal.yaml`. A failure here is fatal on purpose: a misconfigured auth mode must stop the process rather than degrade it.
2. Log the agent credential mode and, if `auth.mode` is `none`, a loud warning.
3. Install the error reporting sink.
4. `refreshRepo()`: clone or refresh the managed checkout. Never throws.
5. If `INDEX_ENABLED`, build the vault index.
6. If `MEMORY_ENABLED`, create or refresh the memory worktree.
7. Register built-in jobs and run job recovery (this opens the database, which runs migrations).
8. If `KB_WRITE_ENABLED` is off, stop here. Otherwise: unshallow the checkout, sweep orphaned worktrees, drain the package and meeting queues if those features are on, and start the refresh timer.

Steps 4 to 8 are wrapped so that one failing step is logged and the next one still runs.

## Database and migrations

- The file is `PORTAL_DB_PATH`. `openDb` creates the parent directory, sets `journal_mode = WAL`, `busy_timeout` (`PORTAL_DB_BUSY_TIMEOUT_MS`, default 5000) and `synchronous = NORMAL`, then migrates (`../lib/db/client.ts`).
- Migrations are an ordered, forward-only array of functions (`MIGRATIONS` in `../lib/db/migrations.ts`, assembled from the frozen `migrations-history-N.ts` files plus newer entries). The schema version is SQLite's `PRAGMA user_version`. The runner executes every pending step inside its own transaction and stamps the new version in the same transaction, so a step is all or nothing (`../lib/db/migrate.ts`).
- Migrations run whenever a connection is first opened, which on a normal boot is step 7 above. A failing migration logs `db migration failed` and rethrows. Because the boot step catches and logs errors, the process can stay up while every database-backed request fails, so watch the boot log after an upgrade.
- There is no down migration. Back up the database file before upgrading, since a rollback to older code against a migrated file is not supported by the runner.
- Tests open `:memory:` databases through the same function.

## Background jobs

Jobs are named units of work with an optional feature flag and a family. A family is a serial queue inside the process, so two jobs in the same family never overlap (`../lib/jobs/`).

| Job | Flag | Family | Does |
| --- | --- | --- | --- |
| `repo-refresh` | none | `maintenance` | Runs `refreshRepo()`. |
| `reconcile` | `AUTHORITY_ENABLED` | `maintenance` | Runs the authority reconcile. |
| `meetings-retry-failed` | `MEETINGS_ENABLED` | `meetings` | Requeues failed meeting ingests. |
| `meetings-poll` | `MEETINGS_ENABLED` | `meetings` | Polls the meetings source. |

Operators can register additional jobs in `../lib/jobs/operator-jobs.ts`, which is an empty list by default.

How a job is triggered:

- **HTTP.** `POST /api/cron/<job>` with the header `x-cron-secret: <CRON_SECRET>` (compared in constant time). Wire it to any scheduler, such as a Kubernetes CronJob or a host cron entry running `curl`. With `CRON_SECRET` unset every call returns 401. Responses: 202 with `enqueued` or `noop` (a run of the same job is already pending or processing), 204 when the job's flag is off, 404 for an unknown job, 500 if the run state could not be recorded. The call returns immediately and the job runs on the queue.
- **CLI.** `pnpm job <name>` runs one job synchronously and exits 0 on success, 1 otherwise (`../scripts/job.ts`). The CLI registers the built-in jobs itself before looking the job up.
- **Flag check.** Both paths test the job's flag with `process.env[flag] === "1"`, which reads the environment only. A flag overridden through `access/flags.yaml` does not change whether these jobs run.

Run history is stored in the `job_runs` and `job_cursors` tables. At boot, any run left in `processing` by a crashed process is marked failed with `requeued after process restart` and run again.

Other background work is not driven by the cron route: the refresh timer in `instrumentation.ts` (every `REPO_REFRESH_INTERVAL_MS`, default 300000, only when `KB_WRITE_ENABLED` is on), the package and meeting queues drained at boot, memory consolidation after a chat thread ends, and the push webhook at `POST /api/repo/refresh`. Their details are in [knowledge-base.md](./knowledge-base.md).

## Feature flags

A feature flag is an `*_ENABLED` switch registered in `../lib/config/flag-registry.ts`. `isFlagEnabled` reads `access/flags.yaml` from the memory worktree first (changed live from the admin Flags tab) and otherwise the environment variable being `"1"`. Flags marked `effect: "restart"` in the registry, such as `KB_WRITE_ENABLED`, are read at boot for parts of their behavior (tool registration, boot steps), so change them with a restart.

## Optional sidecars

| Sidecar | Purpose | How the app finds it |
| --- | --- | --- |
| `scripts/doc-render` | Headless Chromium that renders a document to PDF and self-contained HTML. Stateless. Without it, uncached PDF and HTML exports answer 503 (cached renders are still served) while Markdown export keeps working. | `DOC_RENDER_URL`, `DOC_RENDER_TIMEOUT_MS` (default 60000). See [its README](../scripts/doc-render/README.md). |
| `scripts/dictation-whisper` | On-device speech to text for the composer microphone. | `DICTATION_API_URL`. See [its README](../scripts/dictation-whisper/README.md). |
| `scripts/llm-gate` | Personal LLM keys and token budgets in front of a gateway container. Pulls a snapshot from the app and pushes usage back. | Shared secret `LLM_GATE_SECRET` on both sides, and the app's `/api/internal/llm/*` routes. See [its README](../scripts/llm-gate/README.md). |

The core application needs none of them.

## Write-path doctrine

These rules hold for every knowledge base edit, whichever feature produces it:

- **No in-place mutation of the live vault.** Reads come from the managed checkout. Edits happen in a per-thread `git worktree` created from `origin/main`, so a half-finished draft is never visible to other readers and a mistaken tool call cannot corrupt what others are reading.
- **Allow-listed to the vault at the tool layer.** Write tools resolve every path against the worktree's vault directory, apply the ignore list and the system-owned list, follow symlinks before checking containment, and stage with `git add` scoped to the vault directory. The agent's generic file-editing tools are denied by the permission gate. This is code, not prompt wording.
- **Reviewable by default.** In the default `mr` mode every agent or publish edit lands as a change request (merge request or pull request) from a `kb/<author>/<slug>-<timestamp>` branch. The app opens it and does not merge it. A person with the approve capability merges through the review queue (the merge is pinned to the commit the reviewer was shown) or on the git host.
- **Never force-push.** No git push in the write path or the memory path is forced. Worktree cleanup uses `git worktree remove --force`. A rebase conflict is reported and the worktree is kept. In `direct` mode, a push that loses a race is retried once after a new fetch and rebase.
- **Explicit human confirmation.** `kb_submit` is the one tool that pushes, and it pauses for the thread owner's confirmation every time.
- **Attribution.** The commit author is the contributor and the committer is the portal bot identity (`git.botName`, `git.botEmail`).
- **Opt-in exceptions.** `KB_WRITE_MODE=direct` pushes a fast-forward to `main` without a change request, for submitters with the approve capability. Shared document publication can select direct mode per request under the same capability, and meeting ingestion always commits directly. `KB_WRITE_MODE=direct` is off unless you set it, is refused on the remote MCP surface, and is escalated to a change request for a submission that the integrity check flags.
- **A separate ref for application state.** Memory and the access files live on the orphan `portal-memory` branch, which is never merged into `main`, and their writer accepts only a fixed list of paths.

The step-by-step sequence, branch naming, token permissions and the review queue are in [knowledge-base.md](./knowledge-base.md#the-write-path).
