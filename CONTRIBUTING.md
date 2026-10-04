# Contributing

Thanks for helping. This project is licensed under AGPL-3.0-only, and contributions are accepted under the same license.

## Setup

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Node 22 and pnpm are required (`.node-version` and `packageManager` in `package.json` pin them). The test suite spawns the real `git` binary, so install git.

## Before you open a pull request

```sh
pnpm lint
pnpm test
pnpm build
```

All three must pass.

## Conventions

- TypeScript throughout. New source files stay under 300 lines; split by responsibility (types, constants, validation, utilities).
- A new subsystem or route gets its own `*_ENABLED` feature flag, registered in `lib/config/flags-*.ts`. With the flag off, existing behavior must be unchanged.
- Database modules take `db: DatabaseType` as the first argument and use prepared statements with named parameters. Tests open `openDb(":memory:")`.
- API routes export `dynamic = "force-dynamic"` and `runtime = "nodejs"`, resolve identity with `requireIdentity(request.headers)`, and return errors as `Response.json({ error }, { status })`.
- Database migrations are append-only. Never edit a migration that has shipped.
- Tests use vitest as configured. Do not add a new mocking library or test helper.
- Write prose, comments, and commit messages without em dashes.

## Write-path rules

Knowledge base edits always land as a reviewable merge or pull request, created from an ephemeral worktree and branch. Nothing in this project may auto-merge, force-push, or modify the live vault. The write path is allow-listed to knowledge base content paths at the tool layer. Changes that weaken any of this will not be accepted.

## Commits and pull requests

Use conventional commit messages (`feat(scope): ...`, `fix(scope): ...`). Keep a pull request to one logical change and describe how you verified it.
