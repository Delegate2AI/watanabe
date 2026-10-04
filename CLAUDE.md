# Watanabe: instructions for coding agents

Watanabe is an AI-native company workspace. Chat with Claude is the front door. A user creates documents and then chooses a disposition: keep them private, share with people or groups, or promote them into the knowledge base, which is a git repository (the vault) changed only through reviewable merge or pull requests.

## Stack

Next.js 16 App Router (nodejs runtime), TypeScript, `@anthropic-ai/claude-agent-sdk`, better-sqlite3, Tailwind v4, vitest, pnpm. Node 22.

## Commands

- `pnpm dev`: dev server on port 3100.
- `pnpm lint`, `pnpm test` (vitest run), `pnpm build`. All three must pass before a change is done.
- The test suite spawns the real `git` binary.

## Layout

- `app/`: App Router pages and API routes. `app/api/mcp` serves the MCP endpoint.
- `components/`: React components, grouped by surface.
- `lib/`: domain code. Notable modules: `agent/` (chat agent and the permission gate), `kb-mcp/` (knowledge base tools), `kb-write/` and `repo-write.ts` (the write path), `git-host/` (GitLab and GitHub providers), `db/` (SQLite, migrations), `config/` (`portal.yaml` schema, loader, feature flags), `auth/` (auth strategies), `authority/` (clearance and roles).
- `scripts/`: sidecars (`doc-render`, `dictation-whisper`, `llm-gate`) and seed scripts.

## Configuration

`lib/config/schema.ts` defines `portal.yaml`; `portal.example.yaml` documents it. Precedence is defaults, then `portal.yaml`, then environment. `.env.example` lists every environment variable.

## Write-path doctrine

The agent never auto-merges, never force-pushes, and never mutates the live vault. Every knowledge base edit lands as a reviewable merge or pull request created from an ephemeral worktree and branch. The write path is allow-listed to knowledge base content paths at the tool layer, in code, never as a prompt instruction a session could talk itself past. `gateAgentTool` in `lib/agent/permissions.ts` is the single authority for tool permissions. Do not weaken it.

## Conventions

- DB modules take `db: DatabaseType` as the first argument, use prepared statements with named parameters, and their tests open `openDb(":memory:")`.
- Migrations are frozen once executed. Add a new one; never edit a shipped one.
- Routes export `dynamic = "force-dynamic"` and `runtime = "nodejs"`, resolve identity with `requireIdentity(request.headers)`, and return errors as `Response.json({ error }, { status })`.
- Modules with a never-throws contract (`lib/memory/mem-tools.ts`, `lib/index/cache.ts`, `lib/quality/agents.ts`) degrade gracefully. A change must not add a throw path to them.
- Use vitest as configured. Do not add a mocking library or a new test helper.
- Keep new source files under 300 lines.
- No em dashes in prose, comments, docs, or commit messages.

## Feature flags

A new subsystem or route gets its own `*_ENABLED` flag, registered in `lib/config/flags-*.ts` and read through `isFlagEnabled`, which checks `access/flags.yaml` first and falls back to the environment variable being `"1"`. Flag-off must leave existing behavior unchanged. The flag is the operator's kill switch, not a staging area: ship a finished feature enabled in the same change unless it is unfinished.
