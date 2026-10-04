# Watanabe

Watanabe is an AI-native workspace for a company. Chat with Claude is the front door: people ask questions, draft documents, and then decide what happens to each one. A document can stay private, be shared with people or groups, or be promoted into a git-backed knowledge base through a reviewable merge request or pull request.

It runs in a browser, so contributors who do not use git or a local Claude Code install can still read from and contribute to the knowledge base.

## Features

- Chat assistant built on the Claude Agent SDK, grounded in your knowledge base.
- In-chat documents, saved artifacts, and a canvas for editing them.
- Disposition for every document: private, shared with people or groups, or promoted to the knowledge base.
- Knowledge base writes land as reviewable merge requests (GitLab) or pull requests (GitHub). The assistant never merges, never force-pushes, and never edits the live vault.
- Review queue for approvers, group-based clearance on knowledge base content, and an optional memory branch for durable agent memory.
- Projects, tasks, shared documents with comments and proposed edits, and a people directory.
- Optional integrations: meeting ingestion, an MCP server for external clients, external MCP connectors, installable Agent Skills, document export through a render sidecar, voice dictation, and personal LLM keys through a 9router sidecar.
- Every subsystem sits behind a feature flag that admins can flip at runtime.

## Quick start

You need Docker with Compose and an Anthropic API key.

```sh
mkdir -p vault
printf '# Welcome\n\nThis is the knowledge base.\n' > vault/welcome.md
export ANTHROPIC_API_KEY=your-key
docker compose up --build
```

Open http://localhost:3100. The quick start binds to 127.0.0.1 only and mounts the local `vault` directory read-only as the knowledge base and runs with authentication disabled (`auth.mode: none`, which also requires `PORTAL_ALLOW_NO_AUTH=1`). That is for local evaluation only. Do not expose it to a network.

Without Docker:

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

Set `LOCAL_REPO_PATH` to a local checkout of your knowledge base and `DEV_IDENTITY_EMAIL` to the identity you want to run as, then open http://localhost:3100.

## Configuration

Configuration has three layers, lowest to highest precedence: built-in defaults, `portal.yaml`, then environment variables.

- `portal.example.yaml` documents every `portal.yaml` key: branding, starter cards, assistant house rules, bot identities, embed origins, and the authentication mode (`proxy-header`, `jwt`, `oidc`, or `none`). Copy it to `portal.yaml` or point `PORTAL_CONFIG` at it.
- `.env.example` lists every environment variable the application reads, including the feature flags.

### Git hosts

Point `REPO_URL` at your knowledge base repository and supply `REPO_READ_TOKEN` and `REPO_WRITE_TOKEN`. GitHub (including GitHub Enterprise) and GitLab are supported. The host is detected from `REPO_URL`: github.com selects GitHub, anything else selects GitLab. Set `GIT_HOST=github` or `GIT_HOST=gitlab` to choose explicitly.

## Development

```sh
pnpm dev     # http://localhost:3100
pnpm test    # vitest
pnpm lint    # eslint
pnpm build   # production build
```

See `CONTRIBUTING.md` and `CLAUDE.md` for conventions.

## License

Watanabe is licensed under the GNU Affero General Public License v3.0 only. See `LICENSE` and `NOTICE`.
