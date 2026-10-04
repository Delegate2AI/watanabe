# Deployment

This document covers running Watanabe in production from the container image built by the `Dockerfile` in the repository root: building the image, configuration, persistent storage, probes, reverse proxy and TLS, the single-replica constraint, sidecars, scheduled jobs, backups, upgrades, and a final checklist. It describes only what the code and the shipped `docker-compose.yml` show. There is no Helm chart in this tree. On Kubernetes the same image, environment variables, and volumes apply.

For first-time local use, see [getting started](./getting-started.md). For the configuration reference, see [configuration](./configuration.md).

## The image

The `Dockerfile` has two stages.

| Stage | Base | What it does |
| --- | --- | --- |
| `builder` | `node:22-slim` | Enables pnpm 9.15.9 through corepack, installs `python3`, `make` and `g++` (fallback for compiling `better-sqlite3` when no prebuilt binary matches), runs `pnpm install --frozen-lockfile`, copies the source, creates an empty `portal.yaml` if none exists in the build context, and runs `pnpm build`. |
| `runner` | `node:22-slim` | Installs `git` and `ca-certificates`, creates user `appuser` (uid 1001), copies the Next.js standalone output, `.next/static`, `public`, and `portal.yaml` from the builder, then runs as uid 1001. |

Facts about the runtime image:

- The entrypoint is `CMD ["node", "server.js"]`, the Next.js standalone server.
- It listens on `PORT=3100` and `HOSTNAME=0.0.0.0` (both set as image environment variables). `EXPOSE 3100`.
- `NODE_ENV=production` and `NEXT_TELEMETRY_DISABLED=1` are set.
- `CLAUDE_CONFIG_DIR=/data/claude` is set so the Claude Agent SDK stores session transcripts on the data volume.
- The image declares no `VOLUME` and no `HEALTHCHECK`. Mount storage and configure probes in your orchestrator.
- `git` is required at runtime: the application spawns the `git` CLI to clone, fetch, and reset the managed checkout, and for the write path.
- The Agent SDK platform binaries are force-included in the standalone output (`next.config.ts`), so chat works on the architecture you build on. Build on the architecture you run.

Build and tag:

```sh
docker build -t your-registry.example.com/watanabe:1.0.0 .
docker push your-registry.example.com/watanabe:1.0.0
```

### How `portal.yaml` is baked or mounted

`portal.yaml` is copied into the image from the build context at `/app/portal.yaml`. If the build context has none, an empty file is baked in and built-in defaults apply. At runtime the loader reads `PORTAL_CONFIG` when set, otherwise `./portal.yaml` in the working directory (`/app`). An explicit `PORTAL_CONFIG` that points at a missing file stops the process at boot.

You can therefore either bake the file into the image or mount one and set `PORTAL_CONFIG`, as `docker-compose.yml` does with `/config/portal.yaml`. Environment variables override the file for `LOCAL_REPO_PATH`, `VAULT_SUBDIR`, and `PORTAL_PROXY_ASSERT_SECRET`.

One setting is read at build time rather than at runtime: `embed.frameAncestors`. `next.config.ts` calls `loadEmbedConfig()` while building and bakes the result into the `Content-Security-Policy: frame-ancestors` header for `/embed`. Changing it requires rebuilding the image with the new `portal.yaml` available to the build.

Do not put secrets in a baked `portal.yaml`. The file supports `${VAR}` interpolation, so reference environment variables instead.

## Required configuration

The process refuses to start on an invalid `portal.yaml`. It also refuses to start in these cases:

- `auth.mode: none` without `PORTAL_ALLOW_NO_AUTH=1`. Never set this in production, since it disables authentication.
- `auth.mode: oidc` without `PORTAL_OIDC_CLIENT_SECRET`, without `PORTAL_SESSION_SECRET` of at least 32 characters, without `auth.oidc.issuer` for a non-Google provider, or with neither `allowedDomains` nor `allowedEmails`. See [OIDC auth mode](./oidc-auth-mode.md).

Minimum environment for a production deployment backed by a git host:

| Variable | Purpose |
| --- | --- |
| `PORTAL_DB_PATH` | SQLite file. Set to `/data/portal.db` (the image default is `.data/portal.db` under `/app`, which is not on a volume). |
| `REPO_URL`, `REPO_READ_TOKEN` | Repository to clone. With a read token set the portal manages its own checkout and ignores `LOCAL_REPO_PATH`. |
| `REPO_WRITE_TOKEN` | Needed for `KB_WRITE_ENABLED` and for `MEMORY_ENABLED`. |
| `VAULT_SUBDIR` | Vault directory inside the repository (defaults to `docs` when unset). |
| `AGENT_CHAT_API_KEY` or `AGENT_CHAT_OAUTH_TOKEN` | Assistant credential. Setting either (or `AGENT_CHAT_REMOTE=1`) puts the deployment in remote mode, where a missing credential is an error. |
| `BOOTSTRAP_ADMINS` | Comma separated administrator emails. |
| Authentication | `auth.mode` in `portal.yaml` plus its secrets. See [authentication](./authentication.md). |
| Feature flags | `*_ENABLED=1` for each subsystem you want. See [configuration](./configuration.md). |

Other variables to set when you use the matching feature: `CRON_SECRET` (scheduled jobs), `CONNECTOR_CRED_KEY` (connector credentials), `MCP_PUBLIC_ORIGIN` (MCP and connector OAuth), `REPO_REFRESH_WEBHOOK_SECRET` (push webhook), `PORTAL_PROXY_ASSERT_SECRET` (proxy-header auth). `.env.example` describes each.

## Persistent storage

Everything stateful lives under paths controlled by environment variables. In the image the defaults for most of them are under `/data`, and the compose file mounts a volume there. Mount one persistent volume at `/data`, writable by uid 1001. The compose file does this with a one-shot `chown -R 1001:1001 /data` init container, and you need an equivalent step (an init container, `fsGroup`, or a pre-provisioned directory) on other platforms.

| Path (default) | Variable | Contents | Back up? |
| --- | --- | --- | --- |
| `/data/portal.db` (set it explicitly) | `PORTAL_DB_PATH` | SQLite database: threads, projects, tasks, shared documents, artifacts, activity, and more. Opened in WAL mode. | Yes |
| `/data/memory` | `MEMORY_CHECKOUT_DIR` | Worktree of the `portal-memory` branch. Holds `access/flags.yaml` (runtime flag overrides), plus `access/groups.yaml` and `access/roles.yaml`. | Yes (see below) |
| `/data/repo` | `REPO_CHECKOUT_DIR` | Managed checkout of the knowledge base. Fetched and hard-reset to `origin/main` on every boot. | No, rebuilt from the remote |
| `/data/worktrees` | `WORKTREE_ROOT` | Per-thread worktrees for edits. Orphans are swept at boot when `KB_WRITE_ENABLED` is on. | No |
| `/data/attachments` | `ATTACHMENTS_DIR` | Thread file uploads. | Yes |
| `/data/project-docs` | `PROJECT_DOCS_DIR` | Project document files. | Yes |
| `/data/packages` | `PACKAGES_DATA_DIR` | Update package data. | Yes |
| `/data/renders` | `DOC_RENDERS_DIR` | Rendered document exports. | Optional |
| `/data/index` | `INDEX_CACHE_DIR` | Generated vault index, rebuilt at boot when `INDEX_ENABLED` is on. | No |
| `/data/authority` | `AUTHORITY_PROJECTION_DIR` | Clearance-filtered projections of the vault, rebuilt lazily. | No |
| `/data/claude` | `CLAUDE_CONFIG_DIR` | Agent SDK session transcripts (set in the image). | Yes, if you want chat history to survive |
| `.data/skills` under `/app` | `PORTAL_SKILLS_DIR` | Installed Agent Skills. The default resolves against the working directory, not `/data`. | Yes |

Set `PORTAL_DB_PATH=/data/portal.db` and `PORTAL_SKILLS_DIR` to a path under `/data` (for example `/data/skills`), because neither default lands on the volume in the image. The compose file sets `PORTAL_DB_PATH` for the same reason.

Why these must persist: the database and the memory worktree hold state that exists nowhere else. The portal also needs its checkout to survive restarts only as a cache. If `/data/repo` is lost the next boot clones it again, provided the git host is reachable. Because the checkout is reset on every boot, never store anything of your own in it.

Note that runtime flag changes made from the admin Flags tab are written to `access/flags.yaml` in the memory worktree, which is why that directory is state, not cache.

## Health and readiness probes

The application exposes two unauthenticated probe endpoints. Neither requires an identity header, so they work for an orchestrator that has no sign-in.

| Endpoint | Purpose | Success | Failure |
| --- | --- | --- | --- |
| `GET /api/health` | Liveness. Imports nothing stateful, so it answers even when the database or vault is unavailable. | `200` `{"status":"ok"}` | Process not answering |
| `GET /api/ready` | Readiness. Checks the vault, the database, and the assistant credential. | `200` `{"ready":true,"agentAuth":"<mode>"}` | `503` `{"ready":false,"checks":{...},"agentAuth":"<mode>","failed":[...]}` |

The readiness checks:

| Check | Passes when |
| --- | --- |
| `docs` | The vault root exists and contains at least one entry. The vault root is the checkout plus `VAULT_SUBDIR`, or, with `AUTHORITY_ENABLED`, the `all-hands` projection, so a checkout holding only restricted notes fails the check. |
| `db` | A throwaway row can be inserted into and deleted from a scratch table `_readycheck`. This proves the database is writable, not merely readable. |
| `credential` | The assistant credential resolves. In remote mode (any of `AGENT_CHAT_REMOTE=1`, `AGENT_CHAT_OAUTH_TOKEN`, `AGENT_CHAT_API_KEY`) a missing token or key fails the check. It does not validate the credential against Anthropic. |

`agentAuth` is one of `claude-code`, `local`, `remote-oauth`, or `remote-api-key`. The response never contains secrets or paths.

Kubernetes style probe definition:

```yaml
livenessProbe:
  httpGet: { path: /api/health, port: 3100 }
readinessProbe:
  httpGet: { path: /api/ready, port: 3100 }
```

A failed clone does not crash the process (it is logged and the server keeps starting), so a bad `REPO_READ_TOKEN` shows up as `/api/ready` returning `"failed":["docs"]` on a fresh volume, not as a crash loop. Do not use `/api/ready` as the liveness probe.

## Reverse proxy and TLS

The application listens on plain HTTP and does not terminate TLS. Terminate TLS at your ingress or reverse proxy and forward to port 3100. What the code requires of the proxy:

- Overwrite `X-Forwarded-For`. The in-process rate limiter keys on the first address in that header and trusts it as given. A proxy that appends to or passes through a client-supplied value lets a caller choose its own rate-limit key. With no header the limiter uses a single shared bucket. See `lib/http/rate-limit.ts`.
- Serve the portal over HTTPS when using `auth.mode: oidc`. Session cookies are marked secure when `auth.oidc.baseUrl` is an https URL.
- Set `MCP_PUBLIC_ORIGIN` to the public https origin if you use the MCP server or connector OAuth. The value must be https (plain http is accepted only for localhost, `127.0.0.1`, and `[::1]`); otherwise the feature reads as not configured. Connector OAuth redirect URIs use `auth.oidc.baseUrl` first and `MCP_PUBLIC_ORIGIN` second.
- For `auth.mode: proxy-header`, the proxy must inject the identity headers and the shared secret named by `PORTAL_PROXY_ASSERT_SECRET`, and clients must not be able to reach the pod except through the proxy. See `portal.example.yaml` and [authentication](./authentication.md).
- For embedding, `/embed` is served with `Content-Security-Policy: frame-ancestors <embed.frameAncestors>`. Set `embed.frameAncestors` in `portal.yaml` to the origins allowed to frame it, and rebuild the image (see above). The example value is `'self' http://localhost:*`.
- Leave unauthenticated paths reachable by their callers where you use them: `/api/health`, `/api/ready`, `/api/cron/<job>` (secret header), `/api/repo/refresh` (webhook secret), and the webhook and OAuth routes you enable.

Do not run production with `DEV_IDENTITY_EMAIL` or `PORTAL_ALLOW_DEV_IDENTITY_HEADER=1`. They are for local development and let a request run as an identity without signing in.

### Push webhook

`POST /api/repo/refresh` refreshes the managed checkout when the knowledge base changes. It authenticates with an `X-Gitlab-Token` header compared to `REPO_REFRESH_WEBHOOK_SECRET`. It answers `501` when the secret is unset, and `401` when the header is missing or wrong. Without it, the checkout is refreshed at boot and, when `KB_WRITE_ENABLED` is on, every `REPO_REFRESH_INTERVAL_MS` milliseconds (default 300000).

## Single replica

Run one replica. The code shows several reasons, and no code coordinates multiple instances:

- State is a single SQLite file in WAL mode, opened by a process-wide connection.
- The managed checkout, the memory worktree, and edit worktrees are directories of one local filesystem, and the write path runs `git` against them.
- The rate limiter is in-process memory. Its source comment says it is enough for a single app instance and that a multi-instance deployment would need a shared store.
- Warm assistant sessions (up to `AGENT_MAX_WARM_SESSIONS`), the job queue, and pending-job tracking are held in process memory.

With a single replica and a rolling update strategy, two pods can briefly overlap on the same volume. Use a recreate style update, or a ReadWriteOnce volume that cannot attach to both, so only one process writes the database and worktrees at a time. This is a recommendation derived from the points above, not behaviour the code enforces.

## Scheduled jobs

The application does not schedule anything on its own except the checkout refresh timer described above. Recurring work is triggered from outside by calling an authenticated endpoint on a schedule.

```sh
curl -X POST \
  -H "x-cron-secret: $CRON_SECRET" \
  https://portal.example.com/api/cron/repo-refresh
```

Set `CRON_SECRET` in the application environment. When it is unset, every call is rejected. The route compares the `x-cron-secret` header in constant time.

| Response | Meaning |
| --- | --- |
| `202` with `{"status":"enqueued"}` | The job was queued. |
| `202` with `{"status":"noop"}` | The same job is already pending or processing. |
| `204` | The job exists but its feature flag is off. |
| `401` (empty body) | Missing or wrong secret, or `CRON_SECRET` unset. |
| `404` with `{"error":{"code":"not_found"}}` | Unknown job name. |
| `500` with `{"error":{"code":"internal"}}` | The run-state database could not be read. |

Jobs registered in this tree:

| Job | Flag | What it does |
| --- | --- | --- |
| `repo-refresh` | none | Refreshes the managed checkout. |
| `reconcile` | `AUTHORITY_ENABLED` | Reconciliation for the clearance layer (`runReconcile`). |
| `meetings-retry-failed` | `MEETINGS_ENABLED` | Requeues meetings whose processing failed. |
| `meetings-poll` | `MEETINGS_ENABLED` | Polls for new meetings. |

Run a scheduler of your choice (a Kubernetes CronJob, a systemd timer, or your orchestrator's equivalent) that calls the endpoint with the header above. Jobs run asynchronously: the endpoint returns once the job is queued. Run state is recorded in the database, and a run left `processing` by a crashed process is recovered at boot.

`pnpm job <name>` runs a job in the foreground and exits `0` on success, `1` on failure, unknown name, or disabled flag. It executes `scripts/job.ts` with `tsx` from the source tree. The CLI registers the built-in jobs itself, so `repo-refresh`, `reconcile`, `meetings-retry-failed` and `meetings-poll` all resolve from it. The runtime image contains the standalone server output, and this document does not rely on `pnpm` or `tsx` being available there. Use the HTTP endpoint in production.

## Sidecars

The `scripts/` directory holds three optional services. Each has its own `Dockerfile` and its own README. They are separate containers so the main image stays small. None is required for the core application.

| Sidecar | Directory | Port | Portal variables | Without it |
| --- | --- | --- | --- | --- |
| Document render (PDF and HTML export) | `scripts/doc-render` | `8791` (`RENDER_HOST`, `RENDER_PORT`) | `DOC_RENDER_URL`, plus `DOC_RENDER_CONCURRENCY`, `DOC_RENDER_DEBOUNCE_MS`, `DOC_RENDER_TIMEOUT_MS` | Uncached PDF and HTML exports answer 503, while cached renders stay downloadable. Documents still save, render in the canvas, and export Markdown. |
| Dictation (speech to text) | `scripts/dictation-whisper` | `8790` (`WHISPER_PORT`) | `DICTATION_ENABLED=1`, `DICTATION_API_URL`, optional `DICTATION_API_KEY` matching `WHISPER_API_KEY` | The composer microphone stays disabled. |
| LLM gate (personal keys in front of 9router) | `scripts/llm-gate` | `8790` (`PORT`) | `LLM_KEYS_ENABLED`, `LLM_GATE_URL`, `LLM_GATE_SECRET`, `LLM_ROUTER_URL`, `NINEROUTER_ADMIN_PASSWORD`, `LLM_PUBLIC_URL` | Personal LLM keys are unavailable. |

Build and run each from its directory:

```sh
docker build -t your-registry.example.com/doc-render:1.0.0 scripts/doc-render
docker build -t your-registry.example.com/dictation-whisper:1.0.0 scripts/dictation-whisper
docker build -t your-registry.example.com/llm-gate:1.0.0 scripts/llm-gate
```

Notes from the sidecar sources:

- Render: the image bundles a headless Chromium, so it is large, and it downloads fonts at build time, so the build needs network access. It holds no state and exposes `GET /health` and `POST /render`. Point `DOC_RENDER_URL` at it, for example `http://doc-render:8791`.
- Dictation: the image bakes in the `base.en` model. It binds `0.0.0.0:8790` in the image. Audio is decoded in memory and not written to disk. It exposes `GET /health`.
- LLM gate: it runs next to a 9router container and reaches it at `ROUTER_URL` (default `http://127.0.0.1:20128`). It calls the portal at `PORTAL_URL` (default `http://watanabe:3100`) and requires `LLM_GATE_SECRET`, shared with the portal. With the secret unset, the gate never receives a snapshot from the portal, so requests that carry a caller key get 503, requests without a caller key get 401, and `POST /invalidate` answers 501. It keeps its state in memory and the README states it runs as one replica. `GET /healthz` answers from the process alone.

The portal does not put authentication in front of these sidecars (the dictation backend has an optional bearer key). Keep them on a private network reachable only by the portal (the render and dictation READMEs assume cluster-internal access), and see each README: [doc-render](../scripts/doc-render/README.md), [dictation-whisper](../scripts/dictation-whisper/README.md), [llm-gate](../scripts/llm-gate/README.md).

## Backups

Back up what cannot be rebuilt from the git remote:

1. The SQLite database. It runs in WAL mode, so a plain file copy of `portal.db` taken while the process runs can miss data held in the `-wal` file. Use SQLite's online backup (`sqlite3 portal.db ".backup backup.db"`), or stop the process and copy `portal.db` together with `portal.db-wal` and `portal.db-shm`.
2. The memory worktree `/data/memory`. It is a git worktree on the `portal-memory` branch and holds `access/flags.yaml`, `groups.yaml`, and `roles.yaml`. When `MEMORY_ENABLED` and `REPO_WRITE_TOKEN` are in use, the branch is also pushed to your git remote. Backing up the directory covers deployments where that is not so.
3. `/data/attachments`, `/data/project-docs`, `/data/packages`, and the directory you chose for `PORTAL_SKILLS_DIR`.
4. `/data/claude` if you want to preserve chat history transcripts.

You do not need to back up `/data/repo`, `/data/worktrees`, `/data/index`, or `/data/authority`. The knowledge base itself lives in your git repository and follows its own backup policy.

## Upgrades

1. Back up the database and memory worktree.
2. Build the new image from the new source and tag it.
3. Roll the single replica to the new image, keeping the same volume and environment.
4. Watch `/api/ready` return `200`.

Migrations run on boot. The database is opened and migrated on first use, which happens during startup (job registration opens it), by applying each pending migration in order inside a transaction and stamping SQLite's `user_version` after each one. A failed migration rolls back its own step, is logged as `db migration failed` and is rethrown. Startup catches errors from job registration (which opens the database), so the process can continue running while database-backed requests fail. Watch the boot log after an upgrade. The runner only moves forward, and the code contains no downgrade path. To roll back an image across a schema change, restore the database backup taken in step 1.

Boot also does the following, in order: loads `portal.yaml` (fatal on error), refreshes the checkout, rebuilds the index when `INDEX_ENABLED` is on, prepares the memory worktree when `MEMORY_ENABLED` is on, registers jobs and recovers stuck runs, and, when `KB_WRITE_ENABLED` is on, unshallows the checkout, sweeps orphan worktrees, and recovers package and meeting queues.

## Production checklist

- [ ] Image built from a tagged source revision, with the `portal.yaml` you intend (and `embed.frameAncestors` set) present at build time.
- [ ] Single replica, with an update strategy that never runs two pods against one volume.
- [ ] One persistent volume at `/data`, writable by uid 1001.
- [ ] `PORTAL_DB_PATH` and `PORTAL_SKILLS_DIR` point under `/data`.
- [ ] `auth.mode` is not `none`. `PORTAL_ALLOW_NO_AUTH`, `DEV_IDENTITY_EMAIL`, and `PORTAL_ALLOW_DEV_IDENTITY_HEADER` are all unset.
- [ ] Authentication secrets set (`PORTAL_OIDC_CLIENT_SECRET`, `PORTAL_SESSION_SECRET`, or `PORTAL_PROXY_ASSERT_SECRET`, depending on mode).
- [ ] `REPO_URL`, `REPO_READ_TOKEN`, and (for writes or memory) `REPO_WRITE_TOKEN` set, and `/api/ready` returns `200`.
- [ ] `AGENT_CHAT_API_KEY` or `AGENT_CHAT_OAUTH_TOKEN` set.
- [ ] `BOOTSTRAP_ADMINS` set to your administrators.
- [ ] TLS terminated at the proxy, `X-Forwarded-For` overwritten, `MCP_PUBLIC_ORIGIN` set to the https origin if MCP or connector OAuth is used.
- [ ] `CONNECTOR_CRED_KEY` set if connectors are enabled.
- [ ] `CRON_SECRET` set and a scheduler calling `/api/cron/<job>` for the jobs you need.
- [ ] Liveness on `/api/health`, readiness on `/api/ready`.
- [ ] Sidecars, if used, reachable only from the portal.
- [ ] Database and `/data/memory` backups scheduled and a restore tested.
