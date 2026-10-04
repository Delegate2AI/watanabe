# Environment variables

This page lists every environment variable documented in [../.env.example](../.env.example), grouped the way that file groups them, with the default the code applies and what each variable controls. Structured settings (branding, agent rules, authentication mode) live in `portal.yaml`, see [configuration.md](./configuration.md). Feature switches are also covered in [feature-flags.md](./feature-flags.md).

A few conventions apply throughout:

- Defaults are listed only where the code sets one. "none" means the code treats an unset or empty value as not configured.
- Most values are trimmed before use, and an empty string is generally the same as unset.
- Numeric limits that must be positive fall back to their default when the value is missing, not a number, or not above zero.
- Relative directory paths are resolved against the process working directory. Where the code default is an absolute path under `/data` (the layout used by the container image), the local development value in `.env.example` is `.data/...`.
- Variables are read when the process starts or when the code that uses them runs, not through `portal.yaml`. Only `LOCAL_REPO_PATH`, `VAULT_SUBDIR` and `PORTAL_PROXY_ASSERT_SECRET` also override `portal.yaml` keys, as described in [configuration.md](./configuration.md).

## Configuration file

| Variable | Default | Description |
| --- | --- | --- |
| `PORTAL_CONFIG` | `./portal.yaml` when present | Path to the YAML configuration, resolved against the working directory. If set and the file does not exist, startup fails. |

## Knowledge base repository

| Variable | Default | Description |
| --- | --- | --- |
| `GIT_HOST` | inferred | Git host adapter, `gitlab` or `github` (case insensitive). Unset or unrecognised (a warning is logged), a `github.com` host in `REPO_URL` selects GitHub and any other host selects GitLab. Set to `github` for GitHub Enterprise. |
| `REPO_URL` | none | HTTPS URL of the knowledge base repository. The portal clones it, pushes branches to it, and opens change requests against it. With no URL and no local checkout there is nothing to clone and a message is logged. |
| `REPO_READ_TOKEN` | none | Token with read access. When set, the portal manages its own checkout and ignores `LOCAL_REPO_PATH` and `repo.path`. |
| `REPO_WRITE_TOKEN` | none | Token allowed to push branches and open change requests. Used by the knowledge base write tools, artifact publishing, and the memory branch push. Required for `KB_WRITE_ENABLED` to be useful. |
| `LOCAL_REPO_PATH` | none | Use an existing local checkout as the knowledge base. Honoured only when `REPO_READ_TOKEN` is unset. Overrides `repo.path` in `portal.yaml`. |
| `VAULT_SUBDIR` | `docs` (from `repo.vaultSubdir`) | Directory inside the repository that holds the markdown vault. Empty or `.` means the repository root. Overrides `repo.vaultSubdir`. |
| `REPO_CHECKOUT_DIR` | `/data/repo` | Where the managed checkout is kept. |
| `WORKTREE_ROOT` | `/data/worktrees` | Where per-thread worktrees for edits are created. |
| `REPO_REFRESH_INTERVAL_MS` | `300000` | Interval between background refreshes of the checkout. Runs only when `KB_WRITE_ENABLED` is on. Also reconciles artifacts waiting on review. |
| `REPO_REFRESH_WEBHOOK_SECRET` | none | Shared secret for the push webhook at `POST /api/repo/refresh`. Unset, the route answers 501 and does nothing. A wrong or missing token gets 401. |
| `KB_WRITE_MODE` | `mr` | Set to `direct` (case insensitive) to push knowledge base edits straight to the default branch instead of opening a change request. Any other value means change requests. Also read when setting visibility. |
| `MEMORY_ORIGIN_OVERRIDE` | none | Remote URL used for the private memory branch instead of the one derived from `REPO_URL` and `REPO_WRITE_TOKEN`. |
| `MEMORY_CHECKOUT_DIR` | `/data/memory` | Where the private memory branch worktree is kept. The access files, including `access/flags.yaml`, live under it. |

## Authentication and access

How each authentication mode works is covered in [authentication.md](./authentication.md).

| Variable | Default | Description |
| --- | --- | --- |
| `PORTAL_ALLOW_NO_AUTH` | none | Must be exactly `1` to start with `auth.mode: none`. Local evaluation only: it disables authentication. |
| `PORTAL_ALLOW_DEV_IDENTITY_HEADER` | none | When exactly `1`, honours the `x-dev-identity-email` request header as the caller's identity. Local development only. Never inferred from `NODE_ENV`. |
| `DEV_IDENTITY_EMAIL` | none | Run every request as this identity when no authentication strategy resolves one. Local development only. |
| `PORTAL_PROXY_ASSERT_SECRET` | none | Shared secret the ingress injects so the proxy-header strategy can verify requests came through the proxy. Overrides `auth.proxyHeader.assertSecret`. When neither this variable nor `auth.proxyHeader.assertSecret` supplies a non-empty secret, the identity headers are trusted unverified and a warning is logged. |
| `PORTAL_OIDC_CLIENT_SECRET` | none | OIDC client secret for `auth.mode: oidc`. Startup fails in that mode if it is unset. |
| `PORTAL_SESSION_SECRET` | none | Secret of at least 32 characters used to sign session cookies for `auth.mode: oidc`. Startup fails in that mode if it is missing or shorter. |
| `BOOTSTRAP_ADMINS` | none | Comma separated emails treated as administrators regardless of the role files. |
| `NEXT_PUBLIC_SIGN_OUT_URL` | `/oauth2/sign_out` | URL the sign-out control sends the browser to, for proxy-based sign-in. A `NEXT_PUBLIC_` variable, read by a client component (`components/shell/settings-menu.tsx`), so Next.js inlines it at build time. |
| `MCP_PUBLIC_ORIGIN` | none | Public origin of this portal. Used for connector OAuth redirect URIs when `auth.oidc.baseUrl` is not set, and by the MCP authorization server. Must be https, or http on a loopback host, otherwise it is treated as unset. A path or trailing slash is dropped. |
| `CRON_SECRET` | none | Bearer secret that authorizes calls to the scheduled job endpoint, compared in constant time. Unset, the endpoint is disabled. |
| `CONNECTOR_CRED_KEY` | none | Base64 encoded 32 byte key that encrypts stored connector credentials. Credentials can be sealed only when the decoded key is exactly 32 bytes. |

## Assistant

| Variable | Default | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none | API key for the Claude Agent SDK when running outside a container. In local mode the SDK subprocess inherits the process environment. In a remote deploy the portal sets this variable for the subprocess from `AGENT_CHAT_API_KEY`. It is removed from the subprocess environment when `AGENT_AUTH_MODE=claude-code`. |
| `AGENT_AUTH_MODE` | none | Set to `claude-code` to run the assistant on a local Claude Code login. In this mode the metered credential variables (`ANTHROPIC_API_KEY`, `AGENT_CHAT_API_KEY`, `AGENT_CHAT_OAUTH_TOKEN`, `AGENT_CHAT_REMOTE`, `ANTHROPIC_AUTH_TOKEN`) are removed from the subprocess environment. |
| `AGENT_CHAT_API_KEY` | none | Anthropic API key for a remote or containerized deployment. Setting it marks the deployment as remote. |
| `AGENT_CHAT_OAUTH_TOKEN` | none | Subscription OAuth token for a remote or containerized deployment. Preferred over `AGENT_CHAT_API_KEY` when both are set. Setting it marks the deployment as remote. |
| `AGENT_CHAT_REMOTE` | none | Set to exactly `1` to treat the deployment as remote. A remote deployment must supply `AGENT_CHAT_OAUTH_TOKEN` or `AGENT_CHAT_API_KEY`, otherwise starting an agent session throws. The subprocess then receives only an allowlisted environment (`PATH`, `HOME`, `TMPDIR`, `TZ`, `LANG`, `LC_ALL`, `CLAUDE_CONFIG_DIR`, `NODE_ENV`) plus the mapped credential. |
| `AGENT_CHAT_MODEL` | `claude-opus-4-8` | Default model id for chat and for the memory, quality and design preview agents. |
| `AGENT_CHAT_MODELS` | none | Comma separated list of additional model ids users can switch between. Setting it enables per-conversation model switching. Unset, the selector is inert. |
| `AGENT_MAX_TURNS` | `40` | Maximum turns per conversation. |
| `AGENT_MAX_BUDGET_USD` | `2` | Maximum spend per conversation, in US dollars. |
| `AGENT_MAX_WARM_SESSIONS` | `50` | Maximum number of registered warm agent sessions. The cap counts every registered session, idle or not, so reaching it evicts the least recently used one, which can interrupt a session that is active. |
| `CLAUDE_CONFIG_DIR` | none set by the portal | Where the Agent SDK stores its configuration and session transcripts. Passed through to the agent subprocess. The meeting poller also looks for its Circleback credentials in `CLAUDE_CONFIG_DIR/.credentials.json`, falling back to `~/.claude`. Point it at persistent storage in a container. |
| `QUALITY_AGENT_TIMEOUT_MS` | `60000` | Timeout for the quality check agents. |
| `MEMORY_DREAM_TIMEOUT_MS` | `120000` | Timeout for the memory consolidation run. |
| `DESIGN_PREVIEW_TIMEOUT_MS` | `180000` | Timeout for design guide previews. |
| `PACKAGES_DATA_DIR` | `/data/packages` | Where uploaded update packages are stored. |
| `PACKAGES_MAX_BUDGET_USD` | `5` | Maximum spend per package run, in US dollars. |
| `PACKAGES_MAX_ENTRY_COUNT` | `500` | Maximum number of entries in one package. |
| `PACKAGES_MAX_FILE_BYTES` | `10485760` (10 MiB) | Maximum decompressed size of any single file in a package. |
| `PACKAGES_MAX_TOTAL_BYTES` | `52428800` (50 MiB) | Maximum total decompressed size of one package. |
| `PACKAGES_MAX_TURNS` | `100` | Maximum agent turns per package run. |

## Storage

| Variable | Default | Description |
| --- | --- | --- |
| `PORTAL_DB_PATH` | `.data/portal.db` | SQLite database file. The parent directory is created if missing. |
| `PORTAL_DB_BUSY_TIMEOUT_MS` | `5000` | How long SQLite waits on a locked database. |
| `ASSETS_DIR` | `/opt/assets` | Read by the document render sidecar (`scripts/doc-render/server.mjs`), which loads `mermaid.min.js` from it. The portal itself does not read it. |
| `ATTACHMENTS_DIR` | `/data/attachments` | Base directory for thread attachments. |
| `PROJECT_DOCS_DIR` | `/data/project-docs` | Base directory for project documents. |
| `INDEX_CACHE_DIR` | `/data/index` | Where the generated knowledge base index is cached. |
| `AUTHORITY_PROJECTION_DIR` | `/data/authority` | Where per-clearance projections of the vault are stored. |
| `DOC_RENDERS_DIR` | `/data/renders` | Where rendered PDF and HTML copies of documents are stored. |
| `FONTS_DIR` | `/opt/fonts` | Read by the document render sidecar, which loads `fonts.css` from it. The portal itself does not read it. |
| `ATTACHMENTS_MAX_BYTES` | `10485760` (10 MiB) | Per-file attachment size cap. |
| `DOC_IMPORT_MAX_BYTES` | `5242880` (5 MiB) | Per-file cap for document import. |
| `DICTATION_MAX_BYTES` | `10485760` (10 MiB) | Cap on an uploaded audio clip. |
| `PORTAL_SKILLS_DIR` | `.data/skills` | Where installed skills are stored. A sibling directory named `<name>-materialized` holds per-clearance materializations. |
| `PORTAL_SKILLS_MAX_CLONE_BYTES` | `200000000` | Maximum size of a skill cloned from a git remote. |
| `PORTAL_SKILLS_MAX_CLONE_ENTRIES` | `50000` | Maximum number of entries in a cloned skill. |
| `PORTAL_SKILLS_MAX_UPLOAD_BYTES` | `20000000` | Maximum size of an uploaded skill archive. |
| `UNIFIED_DOCS` | off | Set to exactly `1` to enable the unified document store. |

## Optional services

| Variable | Default | Description |
| --- | --- | --- |
| `DOC_RENDER_URL` | none | Address of the document render sidecar ([../scripts/doc-render/README.md](../scripts/doc-render/README.md)), used for PDF and HTML export. Without it documents are still saved and shown, but PDF and HTML that are not already cached cannot be generated; cached renders remain downloadable. |
| `DOC_RENDER_CONCURRENCY` | `2` | How many background renders (scheduled after a save) may run at once. On-demand export renders do not use this queue. |
| `DOC_RENDER_DEBOUNCE_MS` | `2000` | Delay before a background render starts after a save. Zero is allowed. |
| `DOC_RENDER_TIMEOUT_MS` | `60000` | How long to wait on the sidecar. |
| `RENDER_HOST` | `0.0.0.0` | Interface the render sidecar listens on. Read by the sidecar. |
| `RENDER_PORT` | `8791` | Port the render sidecar listens on. Read by the sidecar. |
| `RENDER_MAX_BYTES` | `8388608` (8 MiB) | Maximum request body the render sidecar accepts. Read by the sidecar. |
| `RENDER_NAV_TIMEOUT_MS` | `20000` | Navigation timeout inside the render sidecar. Read by the sidecar. |
| `DICTATION_API_URL` | none | Address of the speech-to-text backend ([../scripts/dictation-whisper/README.md](../scripts/dictation-whisper/README.md)). Dictation is usable only when `DICTATION_ENABLED` is on and this is set. |
| `DICTATION_API_KEY` | none | When set, sent to the dictation backend as a bearer token. |
| `CIRCLEBACK_WEBHOOK_SECRET` | none | Signing secret that authenticates incoming meeting webhooks. Unset, the receiver refuses every delivery. |
| `MEETINGS_NAME_FILTER` | none | Case insensitive text a meeting name must contain to be picked up by the poll. It filters polling only: meetings delivered by webhook are not checked against it. Unset polls every meeting. |
| `LLM_ROUTER_URL` | none | Address of the 9router admin endpoint. Used by the personal LLM keys feature. |
| `NINEROUTER_ADMIN_PASSWORD` | none | 9router admin password. Without it or `LLM_ROUTER_URL`, key management reports the service as unavailable. |
| `LLM_GATE_URL` | none | Address of the llm-gate sidecar ([../scripts/llm-gate/README.md](../scripts/llm-gate/README.md)). |
| `LLM_GATE_SECRET` | none | Secret shared between the portal and the llm-gate sidecar. Unset on the portal, its internal LLM routes refuse calls. Unset on the sidecar, it never receives a snapshot: requests that carry a caller key get 503, requests without one get 401, `/healthz` still answers 200 and `POST /invalidate` answers 501. |
| `LLM_PUBLIC_URL` | none | Public base URL shown to users for their keys. |
| `ROUTER_URL` | `http://127.0.0.1:20128` | 9router address. Read by the llm-gate sidecar and its contract script, not by the portal. |
| `ROUTER_PASSWORD` | none | 9router password. Read by the llm-gate contract script (`scripts/llm-gate/contract.mjs`), which exits if it is unset. |
| `POSTHOG_HOST` | none | PostHog instance host. |
| `POSTHOG_KEY` | none | PostHog project key. Must match `phc_` followed by at least 20 alphanumeric characters, otherwise it is treated as unset. Analytics sends nothing unless `ANALYTICS_ENABLED` is on and both this and `POSTHOG_HOST` are valid. |
| `DEMO_VAULT_DIR` | `.data/demo-vault` | Directory the demo seed script writes its sample vault to. |

## Feature flags

Each flag below is on only when set to exactly `1`, unless an administrator override in `access/flags.yaml` says otherwise. Resolution rules, the live and restart effects, and dependencies are in [feature-flags.md](./feature-flags.md), which also gives each flag's registry description.

| Variable | Default | Description |
| --- | --- | --- |
| `MEMORY_ENABLED` | off | Stores and recalls durable agent memory from the private memory branch. |
| `INDEX_ENABLED` | off | Builds and serves the generated knowledge base index. |
| `KB_GRAPH_ENABLED` | off | Shows the knowledge base link graph as a tab on the vault map. |
| `QUALITY_GATES_ENABLED` | off | Runs automated quality checks before knowledge base submissions. |
| `INTEGRITY_ENABLED` | off | Flags duplicate or contradicting content against the rest of the knowledge base at submit time. |
| `PACKAGES_ENABLED` | off | Accepts and processes update packages through the write path. |
| `KB_WRITE_ENABLED` | off | Enables reviewable knowledge base edit and submission tools. |
| `AUTHORITY_ENABLED` | off | Applies group clearance to knowledge base reads and administration. |
| `MEETINGS_ENABLED` | off | Enables meeting ingestion, processing, and meeting views. |
| `ANALYTICS_ENABLED` | off | Sends pageviews, interactions, and client-side errors to the self-hosted PostHog, keyed by a pseudonymous id rather than a person's address. |
| `ACTIVITY_ENABLED` | off | Enables the combined activity feed and navigation entry. |
| `CANVAS_ENABLED` | off | Enables in-chat documents, canvas tools, and the canvas pane. |
| `HTML_DOCUMENTS_ENABLED` | off | Lets the assistant author a document as a designed HTML page, and offers every document as PDF, HTML and Markdown. |
| `ATTACHMENTS_ENABLED` | off | Allows thread-scoped file uploads for conversation context. |
| `DICTATION_ENABLED` | off | Enables voice transcription when a dictation backend is configured. |
| `KB_ACCESS_UI_ENABLED` | off | Lets admins edit which groups can see a knowledge base file or folder from the tree. |
| `PEOPLE_ENABLED` | off | Names people from the private people directory instead of printing their email address. |
| `ALIASES_ADMIN_ENABLED` | off | Lets admins map a person's other email addresses to their portal identity from the members list. |
| `PEOPLE_ACTIVITY_ENABLED` | off | Enables the people activity view of who is doing what across meetings and tasks. |
| `CONNECTORS_ENABLED` | off | Admin-registered external MCP servers, clearance-tagged, per-thread opt-in. |
| `CONNECTOR_OAUTH_ENABLED` | off | Per-user OAuth connections for external MCP connectors, the runtime kill switch for the connect flow, credential reads and bearer injection. |
| `SKILLS_ENABLED` | off | Admin-installed Agent Skills, clearance-tagged, loaded into chat sessions. |
| `RICH_EDITOR_ENABLED` | off | Offers a WYSIWYG alternative to the raw markdown source when editing a document body. |
| `MEETINGS_WEBHOOK_ENABLED` | off | Accepts signed Circleback webhook deliveries, so meetings recorded by other workspace members can be ingested. |
| `KB_REVIEW_ENABLED` | off | Shows approvers the knowledge base changes waiting on review, and lets them merge or reject one. |
| `KB_DELETE_ENABLED` | off | Lets an admin propose removing a knowledge base note, as a merge request into the review queue. |
| `DOC_COPILOT_ENABLED` | off | A chat panel on shared documents whose assistant proposes edits as suggestions for human review. |
| `USAGE_AUDIT_ENABLED` | off | Records model usage and cost per turn and shows the ledger to administrators. |
| `LLM_KEYS_ENABLED` | off | Lets staff create their own LLM keys for coding harnesses, routed through a 9router sidecar under token budgets. |
| `TASKS_ENABLED` | off | Enables task extraction, task APIs, and task views. |
| `TASK_COMMENTS_ENABLED` | off | Enables discussion on tasks: a comment list on the task, a count on the cards, and comment activity in What's New. |
| `ROLES_ENABLED` | off | Enforces role-based capabilities for contributors and administrators. |
| `PROJECTS_ENABLED` | off | Enables project workspaces and project context in conversations. |
| `ARTIFACTS_ENABLED` | off | Enables saved artifacts and artifact publishing controls. |
| `SHARED_DOCS_ENABLED` | off | Enables shared document creation, collaboration, and views. |
| `EXTERNAL_SHARE_ENABLED` | off | Allows signed unauthenticated links to shared documents. |
| `DOC_ANNOTATIONS_ENABLED` | off | Enables anchored comment threads and proposed edits on shared documents. |
| `DOC_GROUP_SHARING_ENABLED` | off | Lets a document be shared with a whole team, tracking that team's membership. |
| `SHARED_DOC_PUBLISH_ENABLED` | off | Lets a document owner submit a shared document to the knowledge base as a merge request. |
| `MCP_ENABLED` | off | Serves /api/mcp to members with an MCP client, and runs the OAuth authorization server that lets one register itself. |
| `DOC_IMPORT_ENABLED` | off | Lets a person drop a Markdown or Word file onto their shared documents to import it. |
| `DOC_ACCESS_REQUESTS_ENABLED` | off | Shows a person who opens a document they are not on a "You need access" screen they can ask the owner from, instead of a bare not-found. |
| `KB_PROPOSE_EDIT_ENABLED` | off | Lets a contributor open a draft edit of a knowledge base note, which lands as a merge request. |
