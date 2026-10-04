# Getting started

This guide walks through three ways to run Watanabe for the first time: Docker Compose with a local vault directory, local development with pnpm against a knowledge base checkout, and connecting a real GitLab or GitHub repository. It is more detailed than the [README](../README.md) quick start and lists the first errors you are most likely to hit, using the messages the application prints.

Terms used here: the vault is the markdown directory inside the knowledge base git repository, and a change request is a GitLab merge request or GitHub pull request.

## Path A: Docker Compose with a local vault

This path runs the production image against a plain directory of markdown files. It is for evaluation only: it disables authentication and turns off knowledge base writes.

### Prerequisites

- Docker with the Compose plugin.
- An Anthropic API key.
- A checkout of this repository (the image is built from the `Dockerfile` in the repository root).

### Steps

1. Create a vault directory with at least one file. The readiness probe requires the vault directory to exist and be non-empty.

   ```sh
   mkdir -p vault
   printf '# Welcome\n\nThis is the knowledge base.\n' > vault/welcome.md
   ```

2. Export your key. `docker-compose.yml` maps it to `AGENT_CHAT_API_KEY` inside the container and refuses to start without it.

   ```sh
   export ANTHROPIC_API_KEY=your-key
   ```

3. Build and start.

   ```sh
   docker compose up --build
   ```

4. Open http://localhost:3100.

### What the compose file does

| Item | Behaviour |
| --- | --- |
| `data-init` service | A one-shot busybox container that runs `chown -R 1001:1001 /data` on the `data` volume, so the application user (uid 1001) can write to it. The `watanabe` service waits for it to finish. |
| Port | Published as `127.0.0.1:3100:3100`, so only the local machine can reach it. |
| `./docker/portal.local.yaml` | Mounted read-only at `/config/portal.yaml` and selected with `PORTAL_CONFIG`. It sets the app name and `auth.mode: none` with a fixed local identity. |
| `./vault` | Mounted read-only at `/vault` and used as the knowledge base through `LOCAL_REPO_PATH=/vault` with `VAULT_SUBDIR=""` (the directory itself is the vault). |
| `data` volume | Mounted at `/data`. The database is at `/data/portal.db` (`PORTAL_DB_PATH`). |
| `PORTAL_ALLOW_NO_AUTH=1` | Required to start with `auth.mode: none`. |
| `BOOTSTRAP_ADMINS` | Set to `you@example.com`, which matches the identity in `docker/portal.local.yaml`, so the local identity is an administrator. Change both if you want another address. |
| Feature flags | `KB_WRITE_ENABLED` and `MEMORY_ENABLED` are `"0"`. `CANVAS_ENABLED`, `TASKS_ENABLED`, `PROJECTS_ENABLED`, `SHARED_DOCS_ENABLED`, `ARTIFACTS_ENABLED` and `INDEX_ENABLED` are `"1"`. |

Because `LOCAL_REPO_PATH` is set and `REPO_READ_TOKEN` is not, the application skips cloning and prints `[repo] LOCAL_REPO_PATH is set, skipping clone/refresh, using the local checkout.` at boot.

### What you should see

The container log contains these lines at startup:

```text
[config] auth.mode=none, app.name="Watanabe"
[agent-auth] mode=remote-api-key
[config] AUTHENTICATION IS DISABLED (auth.mode: none). Every request is authenticated as you@example.com. ...
```

Check readiness from the host:

```sh
curl -s http://localhost:3100/api/health
curl -s http://localhost:3100/api/ready
```

`/api/health` returns `{"status":"ok"}`. `/api/ready` returns `{"ready":true,"agentAuth":"remote-api-key"}` when the vault is non-empty, the database is writable, and a credential is present. See [deployment](./deployment.md) for the probe details.

### Most likely first errors

| Symptom or message | Cause and fix |
| --- | --- |
| `set ANTHROPIC_API_KEY to your Anthropic API key` | Compose could not find `ANTHROPIC_API_KEY` in your shell. Export it and rerun. |
| `auth.mode is "none", which disables authentication entirely. Refusing to start without PORTAL_ALLOW_NO_AUTH=1.` | The container started with `auth.mode: none` but without `PORTAL_ALLOW_NO_AUTH=1`. The shipped compose file sets it. If you edited the environment block, restore it. |
| `PORTAL_CONFIG points at <path>, which does not exist` | The `./docker/portal.local.yaml` mount is missing or the path in `PORTAL_CONFIG` is wrong. The process stops at boot rather than falling back to defaults. |
| `/api/ready` returns 503 with `"failed":["docs"]` | The vault directory is empty or not mounted. Add a markdown file to `./vault`. |
| `/api/ready` returns 503 with `"failed":["db"]` | The database could not be written. Check that `data-init` completed and that the volume is writable by uid 1001. |

## Path B: Local development with pnpm

This path runs the Next.js dev server against a knowledge base checkout on your machine, using your own identity.

### Prerequisites

- Node.js. The Dockerfile builds on Node 22, so use Node 22 locally.
- pnpm 9.15.9 (the `packageManager` pinned in `package.json`). `corepack enable` selects it.
- git on your PATH.
- A directory of markdown files, ideally a git checkout of your knowledge base.
- Either an Anthropic API key or a local Claude Code login (see below).

### Steps

1. Install dependencies and create your environment file.

   ```sh
   pnpm install
   cp .env.example .env.local
   ```

   Every line in `.env.example` is commented out. Uncomment and set the values below.

2. Point the application at your knowledge base and choose an identity in `.env.local`.

   ```sh
   LOCAL_REPO_PATH=/path/to/your-knowledge-base
   VAULT_SUBDIR=docs
   DEV_IDENTITY_EMAIL=you@example.com
   BOOTSTRAP_ADMINS=you@example.com
   ```

   `VAULT_SUBDIR` is the directory inside the checkout that holds the markdown. If you leave it unset, the vault defaults to `docs`. Set it to an empty value if the repository root is the vault.

3. Give the assistant a credential. Use one of:

   ```sh
   ANTHROPIC_API_KEY=your-key
   ```

   or, to ride a local Claude Code login instead of metered billing:

   ```sh
   AGENT_AUTH_MODE=claude-code
   ```

   With `AGENT_AUTH_MODE=claude-code` the metered credential variables are removed from the assistant subprocess so only the login is used.

4. Set storage paths. When these are unset, the application uses container paths such as `/data/memory`, `/data/attachments` and `/data/project-docs`, which do not exist on a development machine. Setting them to `.data/...` paths keeps everything inside the repository (the `.data` directory is ignored by git).

   ```sh
   PORTAL_DB_PATH=.data/portal.db
   MEMORY_CHECKOUT_DIR=.data/memory
   ATTACHMENTS_DIR=.data/attachments
   PROJECT_DOCS_DIR=.data/project-docs
   INDEX_CACHE_DIR=.data/index
   AUTHORITY_PROJECTION_DIR=.data/projection
   DOC_RENDERS_DIR=.data/renders
   PACKAGES_DATA_DIR=.data/packages
   WORKTREE_ROOT=.data/worktrees
   CLAUDE_CONFIG_DIR=.data/claude
   ```

   The database default is `.data/portal.db` under the working directory, and the skills store defaults to `.data/skills`. The other directories default to absolute `/data/...` paths, except `CLAUDE_CONFIG_DIR`, which the portal does not default (the container image sets it to `/data/claude`). Set the ones for features you use.

5. Enable the features you want. Flags are read from `access/flags.yaml` in the memory checkout first and otherwise from the environment variable being `1`. A reasonable starting set:

   ```sh
   CANVAS_ENABLED=1
   TASKS_ENABLED=1
   PROJECTS_ENABLED=1
   SHARED_DOCS_ENABLED=1
   ARTIFACTS_ENABLED=1
   INDEX_ENABLED=1
   ```

   `.env.example` lists every flag with a one-line description.

6. Start the server.

   ```sh
   pnpm dev
   ```

7. Open http://localhost:3100.

### Optional: seed demo data

`scripts/seed-demo.ts` fills the database and writes a self-contained demo vault, so every enabled feature has content. Run it from the repository root:

```sh
node_modules/.bin/tsx scripts/seed-demo.ts
```

It loads `.env.local`, then writes to the database at `PORTAL_DB_PATH` (default `.data/portal.db`), writes access files (people and groups) under `MEMORY_CHECKOUT_DIR`, and writes the demo vault to `.data/demo-vault` (override with `DEMO_VAULT_DIR`). It prints the vault path and ends with a hint such as `To use it: LOCAL_REPO_PATH=<path>`. Set that value in `.env.local` and restart `pnpm dev`.

The seeder clears the tables it owns before writing, which also removes hand-made rows in those tables. Run it only against a development database. It is not wired to any route and there is no package script for it.

### What you should see

The terminal prints the `[config]` and `[agent-auth]` lines described in path A, followed by `[repo] LOCAL_REPO_PATH is set, skipping clone/refresh, using the local checkout.` The home page loads as the identity in `DEV_IDENTITY_EMAIL`.

### Most likely first errors

| Symptom or message | Cause and fix |
| --- | --- |
| HTTP 401 with `no identity on this request: sign in via SSO, or for local dev set DEV_IDENTITY_EMAIL ...` | No identity strategy resolved a user. Set `DEV_IDENTITY_EMAIL` in `.env.local` and restart. |
| `auth.mode is "none" ... Refusing to start without PORTAL_ALLOW_NO_AUTH=1.` | Your `portal.yaml` sets `auth.mode: none`. Either add `PORTAL_ALLOW_NO_AUTH=1` or choose another mode. |
| `<file>: invalid configuration` followed by `path: message` lines | `portal.yaml` failed validation. Each line names the offending field. See [configuration](./configuration.md). |
| `[repo] REPO_URL is not set and there is no local checkout ...` | Neither `LOCAL_REPO_PATH` nor `REPO_URL` is set. The server still starts but has no knowledge base to read. |
| `Remote agent-chat deploy requires AGENT_CHAT_OAUTH_TOKEN (preferred) or AGENT_CHAT_API_KEY.` | `AGENT_CHAT_REMOTE=1` is set without a credential. For local runs use `ANTHROPIC_API_KEY` or `AGENT_AUTH_MODE=claude-code` and leave `AGENT_CHAT_REMOTE` unset. |

Run the checks with `pnpm test` and `pnpm lint`, and a production build with `pnpm build`.

## Path C: Connect a real GitLab or GitHub repository

Use this path when the portal should manage its own checkout of your knowledge base and open change requests for edits. Full details are in [knowledge-base](./knowledge-base.md); this section covers the minimum.

1. Remove `LOCAL_REPO_PATH` from the environment. The local checkout is only honored when `REPO_READ_TOKEN` is unset, so setting a read token switches the portal to a managed checkout.
2. Set the repository and tokens:

   ```sh
   REPO_URL=https://github.com/your-org/your-knowledge-base.git
   REPO_READ_TOKEN=your-read-token
   REPO_WRITE_TOKEN=your-write-token
   VAULT_SUBDIR=docs
   ```

   The git host is detected from `REPO_URL`: `github.com` selects GitHub and any other host selects GitLab. Set `GIT_HOST=github` for GitHub Enterprise, or `GIT_HOST=gitlab` to force GitLab.
3. Set `REPO_CHECKOUT_DIR` for where the checkout lives (the default is `/data/repo`). On boot the application clones with `--depth 1` the branch named `main`, or fetches and hard-resets an existing checkout. The branch name is fixed to `main` in the read path.
4. To let the assistant propose edits as change requests, set `KB_WRITE_ENABLED=1`. `.env.example` marks `REPO_WRITE_TOKEN` as required for it.

Expected log lines are `[repo] No checkout at <dir> - cloning <url>.` on the first boot, then `[repo] Docs repo ready at <dir> @ <sha>`.

| Message | Cause and fix |
| --- | --- |
| `[repo] REPO_READ_TOKEN is not set ... cannot clone/refresh the docs repo.` | `REPO_URL` is set but the token is not. Set `REPO_READ_TOKEN`. |
| `[repo] Failed to clone/refresh docs repo at <dir>: ...` | Clone or fetch failed (bad token, wrong URL, or the repository has no `main` branch). Tokens are redacted in this message. The server keeps running and serves whatever is already at that directory. |
| `/api/ready` reports `"failed":["docs"]` | The checkout is missing or the configured `VAULT_SUBDIR` is empty or does not exist in the repository. |

## Next steps

- [Configuration](./configuration.md): `portal.yaml`, environment variables, and feature flags.
- [Authentication](./authentication.md): replace `auth.mode: none` with a real sign-in mode.
- [Access control](./access-control.md): groups, roles, and clearance.
- [Deployment](./deployment.md): run the container image in production.
