# Optional integrations

Watanabe runs on its own with a knowledge base repository and an Anthropic credential. This page covers everything optional that you can add on top: an MCP server for outside clients, external MCP connectors, Agent Skills, update packages, meeting ingestion, document export, dictation, personal LLM keys, product analytics and a repository push webhook. For each one it lists what it does, the feature flags and settings that gate it, the setup steps, and how to confirm it works.

## Conventions used below

- A feature flag is read from `access/flags.yaml` first (admins edit it from the Flags tab of the Access admin page) and otherwise from the environment variable being `1`. Details are in [`../lib/config/flags.ts`](../lib/config/flags.ts). The scheduled-job endpoint is the one exception: it reads the environment variable only (see [Meetings ingestion](#meetings-ingestion)).
- Several registries are YAML files under `access/` in the private memory checkout (`MEMORY_CHECKOUT_DIR`, default `/data/memory`, branch `portal-memory`): `connectors.yaml`, `skills.yaml`, `skill-authors.yaml`. The admin screens write `connectors.yaml` and `skills.yaml` using `REPO_WRITE_TOKEN`. `skill-authors.yaml` is not writable from the admin screens: maintain author grants directly in `access/skill-authors.yaml` on the private memory branch.
- Every variable named here is listed in [`../.env.example`](../.env.example). `portal.yaml` keys are described in [`../portal.example.yaml`](../portal.example.yaml). The only integration with a `portal.yaml` key is Agent Skills (`skills`).
- Routes that answer a request from another system rather than a signed-in browser (the MCP endpoint, the OAuth endpoints, the meeting webhook, the repository webhook, the cron endpoint) authenticate their own credential. If an authenticating reverse proxy sits in front of Watanabe, it must let those paths through, or the outside system never reaches the app. The code for the OAuth discovery documents states this requirement explicitly ([`../app/.well-known/oauth-authorization-server/route.ts`](../app/.well-known/oauth-authorization-server/route.ts)).

| Integration | Flags | Required settings |
| --- | --- | --- |
| [MCP server](#mcp-server-exposed-by-watanabe) | `MCP_ENABLED` | `MCP_PUBLIC_ORIGIN` for OAuth clients |
| [External MCP connectors](#external-mcp-connectors) | `CONNECTORS_ENABLED`, `CONNECTOR_OAUTH_ENABLED` | `CONNECTOR_CRED_KEY` for OAuth connectors, `MCP_PUBLIC_ORIGIN` or `auth.oidc.baseUrl` |
| [Agent Skills](#agent-skills) | `SKILLS_ENABLED` | `PORTAL_SKILLS_DIR` (optional), `skills` block in `portal.yaml` (optional) |
| [Update packages](#update-packages) | `PACKAGES_ENABLED` and `KB_WRITE_ENABLED` | `REPO_WRITE_TOKEN` |
| [Meetings ingestion](#meetings-ingestion) | `MEETINGS_ENABLED`, `AUTHORITY_ENABLED`, `MEETINGS_WEBHOOK_ENABLED` | `REPO_WRITE_TOKEN`, `CRON_SECRET`, `CIRCLEBACK_WEBHOOK_SECRET` |
| [Document rendering](#document-rendering-sidecar) | `HTML_DOCUMENTS_ENABLED` (and `CANVAS_ENABLED` for the export route) | `DOC_RENDER_URL` |
| [Dictation](#dictation) | `DICTATION_ENABLED` | `DICTATION_API_URL` |
| [Personal LLM keys](#personal-llm-keys) | `LLM_KEYS_ENABLED` | `LLM_ROUTER_URL`, `NINEROUTER_ADMIN_PASSWORD`, `LLM_GATE_URL`, `LLM_GATE_SECRET`, `LLM_PUBLIC_URL` |
| [Product analytics](#product-analytics) | `ANALYTICS_ENABLED` | `POSTHOG_HOST`, `POSTHOG_KEY` |
| [Repository push webhook](#repository-push-webhook) | none | `REPO_REFRESH_WEBHOOK_SECRET` |

## MCP server exposed by Watanabe

### What it does

Watanabe serves a Model Context Protocol endpoint at `/api/mcp` (Streamable HTTP, implemented in [`../app/api/mcp/route.ts`](../app/api/mcp/route.ts)). Any MCP client, for example the Claude web app's custom connectors, can read the knowledge base and, with the right credential and role, stage edits, work with shared documents and manage tasks. The server reports itself as `kb`. Every tool call runs as the person who owns the credential, so the client sees only what that person's clearance allows. A file outside their clearance is reported as not found.

Tools are registered per session, so a client never sees a tool it could not call.

| Tools | Who gets them | Extra gate |
| --- | --- | --- |
| `kb_list`, `kb_read`, `kb_search` | Every authenticated caller (token, OAuth or SSO cookie) | none |
| `kb_stage_edit`, `kb_stage_delete`, `kb_stage_move`, `kb_diff`, `kb_check`, `kb_discard`, `kb_submit` | Bearer callers (portal token or OAuth access token) whose person holds the write capability | `KB_WRITE_ENABLED` |
| `shared_doc_create`, `shared_doc_update`, `shared_doc_attach` | Bearer callers whose person holds the write capability | `SHARED_DOCS_ENABLED` |
| `tasks_list`, `tasks_get`, `tasks_create`, `tasks_update`, `tasks_transition` | Bearer callers | `TASKS_ENABLED` |
| `tasks_comment_list`, `tasks_comment_add`, `tasks_comment_delete` | Bearer callers | `TASKS_ENABLED` and `TASK_COMMENTS_ENABLED` |

Notes on the write tools (from [`../app/api/mcp/server.ts`](../app/api/mcp/server.ts) and [`../lib/kb-mcp/write-tools.ts`](../lib/kb-mcp/write-tools.ts)):

- Staging happens in a private worktree keyed to the credential, so a client that reconnects finds its staged work. `kb_diff` shows the staged diff, `kb_check` runs the duplicate and contradiction check (when `INTEGRITY_ENABLED` is on), and `kb_submit` commits.
- On this surface `kb_submit` always opens a change request. It never pushes directly to the default branch, whatever `KB_WRITE_MODE` says.
- Task tools check the person's capabilities on every call. Removing a person from `access/groups.yaml` invalidates every credential they hold.
- Folders owned by a subsystem (the vault `meetings` folder) are readable but not writable through the staging tools ([`../lib/kb-mcp/constants.ts`](../lib/kb-mcp/constants.ts)).
- `lib/doc-mcp/` and `lib/copilot-mcp/` are in-process tool servers for the chat agent and the shared-document copilot panel (`doc_write`, `copilot_read`, `copilot_review_state`, `copilot_suggest`). They are not reachable through `/api/mcp`.

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `MCP_ENABLED` | Master switch. Off, `/api/mcp`, the OAuth endpoints and the discovery documents all refuse. |
| `MCP_PUBLIC_ORIGIN` | The public origin of this deployment, for example `https://portal.example.com`. Required for OAuth clients: the issuer, endpoints and resource URL all derive from it, never from the request's `Host` header. It must be `https`, except that `http` is accepted on `localhost`, `127.0.0.1` and `[::1]`. A value that does not parse reads as unset. |

Without `MCP_PUBLIC_ORIGIN` the OAuth endpoints and discovery documents answer 404, and the Settings page says MCP is not available. Portal tokens (below) still work, because the endpoint itself only checks `MCP_ENABLED`.

### How a client authenticates

The endpoint accepts a bearer token first and an SSO session cookie second ([`../app/api/mcp/auth.ts`](../app/api/mcp/auth.ts)). Either way the credential must identify a known member of `access/groups.yaml`. A missing, unknown, revoked, expired or non-member credential, and the flag being off, all produce the same 401.

**Portal token.** An admin (a person who can manage access) opens Admin, Access, Tokens tab, names a token (1 to 60 characters) and creates it. The plaintext is shown once and cannot be recovered. Only a SHA-256 hash is stored. A portal token has no expiry and is revoked from the same tab or from Settings, MCP access. The API behind the tab is `GET/POST/DELETE /api/admin/mcp-tokens`, and members can list and revoke their own tokens at `/api/settings/mcp-tokens`.

**OAuth (for clients that add a connector by URL).** Watanabe runs an OAuth 2.0 authorization server for this one resource, with these facts taken from [`../lib/mcp-auth/server-config.ts`](../lib/mcp-auth/server-config.ts) and the route handlers:

| Item | Value |
| --- | --- |
| Resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource/api/mcp`, advertised in the `WWW-Authenticate` header of a 401 from `/api/mcp` only when `MCP_ENABLED` is on and `MCP_PUBLIC_ORIGIN` is configured |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server` |
| Client registration (dynamic) | `POST /api/oauth/register`, rate limited to 10 per minute per client. Needs `client_name` and 1 to 10 `redirect_uris`, each `https` (or `http` on loopback) with no fragment |
| Authorization endpoint | `/oauth/authorize` (a page for the signed-in member to approve or deny) |
| Token endpoint | `POST /api/oauth/token`, rate limited to 60 per minute per client |
| Grant types | `authorization_code` and `refresh_token` |
| PKCE | `S256` only |
| Client authentication | none (public clients, no secret is ever issued) |
| Scope | `mcp` only |
| Authorization code lifetime | 60 seconds, single use |
| Access token lifetime | 1 hour |
| Refresh token lifetime | 30 days, rotated on use |

The person approving must be signed in to Watanabe through your normal sign-in and be a known member. An OAuth access token is stored in the same table as a portal token, so it resolves through the same path and shows up in the token list with its client name.

### Setup

1. Set `MCP_ENABLED=1` (or turn on the flag in the Access admin Flags tab).
2. Set `MCP_PUBLIC_ORIGIN` to the public URL users reach Watanabe on.
3. Make sure your proxy passes through `/api/mcp`, `/.well-known/oauth-protected-resource/api/mcp`, `/.well-known/oauth-authorization-server`, `/api/oauth/register` and `/api/oauth/token` without a sign-in redirect. `/oauth/authorize` should stay behind sign-in.
4. Tell users to open Settings, MCP access, which shows the connector address (`<MCP_PUBLIC_ORIGIN>/api/mcp`). They paste it into their client's custom connector dialog, with no client ID or secret, and approve the connection when the page opens.

### Example client configuration

For a client that supports a header (a portal token):

```json
{
  "mcpServers": {
    "knowledge-base": {
      "type": "http",
      "url": "https://portal.example.com/api/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

The `mcpServers` shape above is the Claude Code project file format. Other clients use their own file, but the URL and the `Authorization: Bearer` header are what Watanabe sees.

### Verify

Open a session with a raw request. A working deployment answers with a result and an `Mcp-Session-Id` response header:

```sh
curl -i https://portal.example.com/api/mcp \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"0"}}}'
```

- An unauthenticated request must return 401 with a `WWW-Authenticate: Bearer resource_metadata=...` header (only when `MCP_PUBLIC_ORIGIN` is set and the flag is on).
- `curl https://portal.example.com/.well-known/oauth-authorization-server` must return JSON naming your origin as `issuer`.
- Sessions are held in the memory of the Node process ([`../app/api/mcp/route.ts`](../app/api/mcp/route.ts)). After a restart, clients must initialize again, and a deployment with several replicas needs requests for one session to land on the same one.

## External MCP connectors

### What it does

Operators can register outside MCP servers (a ticketing system, an analytics tool) in a registry. A person turns a connector on for a chat thread, and its tools become available to the assistant in that thread, named `mcp__<slug>__<tool>`. Each entry carries `groups`, and a person sees and can use a connector only if one of those groups is in their clearance. Nothing is merged into a session when the flag is off.

The registry is a YAML file, `access/connectors.yaml`, edited through Admin, Connector registry. There is no built-in catalog: the registry is empty until an admin adds entries. People who want a connector that does not exist can send a request from the Connectors page, and admins resolve it from the registry screen.

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `CONNECTORS_ENABLED` | Master switch for the registry, the pages, the thread opt-in and the tool gate. |
| `CONNECTOR_OAUTH_ENABLED` | Per-user OAuth connections. It only takes effect when `CONNECTORS_ENABLED` is also on. It is the runtime kill switch for the connect flow, credential reads and bearer injection. |
| `CONNECTOR_CRED_KEY` | Base64 encoding of a 32 byte key. Per-user OAuth credentials are sealed with AES-256-GCM, with the person's email, the connector slug and a config fingerprint bound in as additional authenticated data. If the key is missing or is not 32 bytes, the connect flow refuses with a 503 and no credential is stored ([`../lib/connectors/cred-crypto.ts`](../lib/connectors/cred-crypto.ts)). |
| `MCP_PUBLIC_ORIGIN` or `auth.oidc.baseUrl` | Origin used to build the OAuth redirect URI `<origin>/api/connectors/oauth/callback`. `auth.oidc.baseUrl` wins when the auth mode is `oidc`. With neither set the connect flow fails. |

Generate a key with `openssl rand -base64 32`. Treat it as a secret and keep it stable: changing it makes every stored connector credential unreadable, and people must reconnect.

### Registry entry reference

Slugs match `[a-z0-9][a-z0-9-]{0,31}`. The names `kb`, `mem`, `doc`, `tasks`, `copilot` and `content` are reserved. The fields are validated by [`../lib/connectors/types.ts`](../lib/connectors/types.ts):

| Field | Meaning |
| --- | --- |
| `title` | Display name (required). |
| `transport` | `http`, `sse` or `stdio` (required). |
| `url` | Required for `http` and `sse`, not allowed for `stdio`. |
| `command`, `args`, `env` | For `stdio` only. |
| `headers` | Static request headers for `http` and `sse`. |
| `groups` | Clearance groups that may see the connector (required). A person needs at least one of them, so an empty list means nobody. |
| `tools` | Optional allow-list of tool names. Absent means all tools. |
| `description`, `icon` | Optional. `description` is at most 280 characters. `icon` is one of `plug`, `chart`, `chat`, `calendar`, `doc`, `code`, `cloud`, `search`. |
| `auth: oauth` | Makes this a per-user OAuth connector. Needs `http` or `sse`, and no `Authorization` header. |
| `oauthClientId`, `oauthClientSecret` | Optional pre-registered OAuth client. The secret must be exactly one `${VAR}` reference. |
| `authOrigins` | Optional list of exact `https` origins the OAuth endpoints may live on. Only valid with `auth: oauth`. |

`${VAR}` references are resolved from the server environment, and are allowed only in `headers`, `env` and `oauthClientSecret`, never in `url`, `command` or `args`. A reference to a variable that is not set disables just that connector and the thread shows a notice. The admin list shows, per entry, which referenced variables are present.

### Two kinds of connector

**Shared-credential (token) connectors.** The entry holds the credential as a `${VAR}` reference in `headers` or `env`, and the operator sets that variable on the server. Everyone cleared for the connector uses the same credential.

```yaml
connectors:
  tickets:
    title: Ticket tracker
    transport: http
    url: https://mcp.tickets.example.com/mcp
    headers:
      Authorization: Bearer ${TICKETS_API_TOKEN}
    groups: [all-hands]
    tools: [search_tickets, get_ticket]
```

**Per-user OAuth connectors.** Set `auth: oauth`. Each person connects their own account from the Connectors page. The flow (`POST /api/connectors/<slug>/oauth`, then the callback) uses PKCE `S256`, a state value valid for 10 minutes, and metadata discovery against the connector's URL. If `oauthClientId` is set, that client is used. Otherwise Watanabe registers itself dynamically, and the connector is refused if the authorization server offers no registration endpoint. The callback re-checks that the registry entry and the server metadata have not changed since the connect started. Tokens are stored sealed (see `CONNECTOR_CRED_KEY`), the bearer is injected into the connection at session start, and Disconnect deletes the stored credential and attempts to revoke the tokens at the authorization server when it publishes a revocation endpoint. Revocation is best effort and its result does not stop the disconnect, so upstream revocation is not guaranteed. If the connector URL changes after a connect, the stored credential no longer matches the registry entry, so the person must connect again. The thread normally shows "connect first" (the "reconnect required" notice appears only when a resolved credential carries a different URL).

```yaml
connectors:
  analytics:
    title: Product analytics
    transport: http
    url: https://mcp.analytics.example.com/mcp
    auth: oauth
    groups: [all-hands]
    authOrigins:
      - https://auth.analytics.example.com
```

### Setup

1. Set `CONNECTORS_ENABLED=1`. For OAuth connectors also set `CONNECTOR_OAUTH_ENABLED=1`, `CONNECTOR_CRED_KEY`, and one of `MCP_PUBLIC_ORIGIN` or `auth.oidc.baseUrl`. Make sure `REPO_WRITE_TOKEN` is set, since the admin screen commits the registry file.
2. For token connectors, set the `${VAR}` secrets in the server environment.
3. As an admin, open Admin, Connector registry and add the entry with its groups. Use Test to probe it.
4. In a chat, open the thread's connector picker and switch the connector on. For OAuth connectors, the person first connects on the Connectors page.

### Verify

- The Test action on the admin screen connects to the server and returns the number of tools it lists. It supports `http` and `sse`, not `stdio`, times out after 5 seconds, and refuses addresses that resolve to loopback, private, link-local or cloud metadata ranges ([`../lib/connectors/egress-net.ts`](../lib/connectors/egress-net.ts)).
- `GET /api/connectors` as a member lists only entries their groups clear, with `connected` for OAuth entries.
- In a thread with the connector on, the assistant's tool list contains `mcp__<slug>__...` tools. A disabled connector leaves a notice such as `connector <slug> disabled: connect first` instead.

## Agent Skills

### What it does

A skill is a folder with a `SKILL.md` (frontmatter with `name` and `description`) plus optional helper files. Admins install skills into a registry, tag each with clearance groups, and every chat session loads exactly the skills its person is cleared for. Filtering is by physical absence: a skill outside the person's clearance is not in the directory the session is given ([`../lib/skills/materialize.ts`](../lib/skills/materialize.ts)). An entry with an empty `groups` list is visible to nobody.

Skills enter the registry four ways:

| Source | How |
| --- | --- |
| Git | Admin supplies a repository URL, a ref, and optionally a subdirectory. The commit is pinned, and Update re-fetches. Allowed schemes are `file`, `git`, `http`, `https` and `ssh`, with argument-injection guards. |
| Marketplace | Admin picks an item from an index (a JSON document listing skills). A bundled index is offered by default. |
| Zip upload | Admin uploads a `.zip` (default cap 20,000,000 bytes). |
| Authored | A person writes a skill in the Skill studio. Authored skills cannot carry scripts. |

Skills that ship executable helper files are installed with a compatibility report listing the scripts and any `allowed-tools` the app cannot satisfy. A session may run a skill's own bundled script only under the narrow rule in [`../lib/skills/script-policy.ts`](../lib/skills/script-policy.ts).

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `SKILLS_ENABLED` | Master switch. Off, no skill is loaded and the admin routes answer 404. |
| `PORTAL_SKILLS_DIR` | Where installed skills are stored. Default `<working directory>/.data/skills`. A sibling directory named `<name>-materialized` holds the per-clearance plugin directories. |
| `PORTAL_SKILLS_MAX_UPLOAD_BYTES` | Zip upload cap. Default 20000000. |
| `PORTAL_SKILLS_MAX_CLONE_BYTES`, `PORTAL_SKILLS_MAX_CLONE_ENTRIES` | Budget for a git clone. Defaults 200000000 bytes and 50000 entries. |
| `skills.marketplaces` in `portal.yaml` | List of `http(s)` URLs of index documents. A bad scheme fails at boot. |
| `skills.builtinMarketplace` in `portal.yaml` | Default `true`. Set `false` to offer only your own indexes. |

```yaml
skills:
  marketplaces:
    - https://skills.example.com/index.json
  builtinMarketplace: true
```

An index document looks like this. Each entry is validated on its own, and an index is capped at 200 entries:

```json
{ "skills": [ { "name": "release-notes", "description": "Drafts release notes.", "url": "https://git.example.com/skills.git", "ref": "main", "subdir": "release-notes" } ] }
```

### Who can do what

- Admins (people who can manage access) use Admin, Skill registry: install from git, install from a marketplace, upload a zip, update, uninstall and change groups (`/api/admin/skills`, `/api/admin/skills/upload`).
- Authors use Skill studio at `/skills` (`/api/skills/authored`). A person qualifies as an author through the `access/skill-authors.yaml` file, which maps an author to the groups they may publish to, or by being an admin. Authors can edit and remove only the skills they wrote.

### Setup

1. Set `SKILLS_ENABLED=1`. Optionally set `PORTAL_SKILLS_DIR` to persistent storage and add the `skills` block to `portal.yaml`.
2. Make sure `REPO_WRITE_TOKEN` is set, since the registry file `access/skills.yaml` is committed to the memory ref.
3. As an admin, install a skill and tag it with at least one group.

### Verify

- Admin, Skill registry lists the skill with status `ok` and `installed` true.
- A member in one of the skill's groups sees it in a new chat. A member outside those groups does not.
- A broken entry shows as `disabled` with a reason instead of failing the page.

## Update packages

### What it does

A person uploads a set of files or a zip (for example, a hand-off bundle from another tool). A background job copies it into the knowledge base under `99-reference/handoffs/<package name>/`, has the assistant fold its content into the right notes, and opens a change request for human review. Package jobs always open a change request and never push directly. Jobs run one at a time.

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `PACKAGES_ENABLED` | Required, and `KB_WRITE_ENABLED` must be on as well ([`../lib/packages/config.ts`](../lib/packages/config.ts)). |
| `REPO_WRITE_TOKEN` | Required. Without it a job fails with `write_unavailable`. |
| `PACKAGES_DATA_DIR` | Upload storage. Default `/data/packages`. |
| `PACKAGES_MAX_TOTAL_BYTES` | Default 52428800 (50 MB). Uploads larger than this are refused, and a `Content-Length` header is required. |
| `PACKAGES_MAX_FILE_BYTES` | Default 10485760 (10 MB). |
| `PACKAGES_MAX_ENTRY_COUNT` | Default 500. |
| `PACKAGES_MAX_BUDGET_USD` | Per job model spend ceiling. Default 5. |
| `PACKAGES_MAX_TURNS` | Per job turn ceiling. Default 100. |

The job uses `AGENT_CHAT_MODEL` when set.

### API

| Route | Purpose |
| --- | --- |
| `POST /api/packages` | Multipart upload of files or one zip. Returns 201 with `{ id, name, status: "queued" }`. |
| `GET /api/packages` | The caller's packages. |
| `GET /api/packages/<id>`, `DELETE /api/packages/<id>` | One package (owner only), and removal. |
| `POST /api/packages/<id>/retry` | Requeues a package in `failed` or `no_changes`. |

Statuses are `queued`, `processing`, `submitted` (with the change request URL), `no_changes` and `failed`. Binary file types are refused, apart from `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`. Zip entries are checked for path traversal and symlinks. No screen in this source tree drives these routes, so treat them as an API.

### Verify

Upload a small zip of markdown files, then poll `GET /api/packages/<id>` until the status is `submitted`, and open the returned change request URL.

## Meetings ingestion

### What it does

Meetings recorded in Circleback are turned into notes in the vault under `meetings/<year>/`, with the transcript summarized by the assistant and tasks extracted when `TASKS_ENABLED` is on. Each note carries a `visibility` list derived from who attended: attendees are matched to `access/groups.yaml` (after alias resolution), and any attendee who is unknown, or has no email, removes `all-hands`. A meeting with no recognized internal attendee falls back to `admins` only. Notes are committed directly to the default branch under the bot identity from `git.botName` and `git.botEmail`. Re-ingesting an unchanged meeting is a no-op, keyed on a source hash.

Meetings arrive in two ways, which can run together:

- **Poll.** A scheduled job reads new meetings through the Circleback MCP server, using the credentials of one workspace member. It sees only that member's meetings.
- **Webhook.** A workspace admin in Circleback sends an "after every meeting" webhook to Watanabe, which reaches meetings other members recorded, because Circleback's OAuth grants no cross-member access.

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `MEETINGS_ENABLED` | Master switch for ingestion and the Meetings page. |
| `AUTHORITY_ENABLED` | Required. The poll returns early and ingestion records an error without it. |
| `MEETINGS_WEBHOOK_ENABLED` | Turns on the webhook receiver. Also needs `MEETINGS_ENABLED`. |
| `CIRCLEBACK_WEBHOOK_SECRET` | Signing secret for the webhook. Unset, the route answers 404. |
| `MEETINGS_NAME_FILTER` | Poll only meetings whose name contains this text. |
| `REPO_WRITE_TOKEN` | Required to commit notes. |
| `CRON_SECRET` | Required for the scheduler to trigger the poll. Unset, the cron endpoint is disabled. |
| `CLAUDE_CONFIG_DIR` | Directory holding `.credentials.json` for the poll. Default `~/.claude`. |

### Setup

1. Set `MEETINGS_ENABLED=1` and `AUTHORITY_ENABLED=1`, and make sure `REPO_WRITE_TOKEN` is set.
2. **Poll credentials.** The poll does not do its own login. It reads an OAuth entry for a server named `circleback` from `$CLAUDE_CONFIG_DIR/.credentials.json`, under `mcpOAuth`, which the Claude Code CLI writes when you log in to the Circleback MCP server. Log in once with that CLI as the account whose meetings should be ingested and put the resulting file on persistent storage at that path. The access token is refreshed automatically from the stored refresh token, and the file is updated in place. If the entry is missing, the poll fails with `circleback credentials missing`.
3. **Schedule the poll.** Have your scheduler call:

   ```sh
   curl -X POST https://portal.example.com/api/cron/meetings-poll -H "x-cron-secret: $CRON_SECRET"
   ```

   The endpoint answers 202 when the job was queued or is already running, 204 when the job's flag is off in the environment, 404 for an unknown job name, and 401 on a wrong secret. This endpoint checks the flag in the environment only, so `MEETINGS_ENABLED` must be `1` in the environment even if you also manage it from `flags.yaml`.
4. **Webhook (optional).** In Circleback create an automation that sends a webhook after every meeting to `https://portal.example.com/api/webhooks/circleback`, using a signing secret, and set the same value as `CIRCLEBACK_WEBHOOK_SECRET`. Set `MEETINGS_WEBHOOK_ENABLED=1`. Deliveries are verified by an HMAC-SHA256 of the raw body in the `x-signature` header, accepted as hex or base64.

### Verify

- The cron call returns 202, and the Meetings page lists the meeting once processed. A note appears under `meetings/` in the vault.
- A webhook with a bad signature gets 403, and a valid one returns `{ "accepted": true, "meetingId": ... }`.
- The source code states that the webhook signature format has not been confirmed against a live Circleback delivery ([`../lib/meetings/webhook.ts`](../lib/meetings/webhook.ts)). Use Circleback's "send request for most recent meeting" button to confirm. A wrong guess rejects every delivery rather than admitting a forged one.
- Admins can change who may read an ingested note with `POST /api/meetings/reclear` (`notePath` and `visibility`), which opens a change request.

## Document rendering sidecar

### What it does

The assistant can write a document as a designed HTML page, and any chat document can be downloaded as Markdown, HTML or PDF (`GET /api/chat-docs/<id>/export/<md|html|pdf>`). Markdown is produced inside the app. HTML and PDF are produced by a separate headless Chromium service that Watanabe calls over HTTP. Without the sidecar, documents still save, still display in the canvas and still export as Markdown. A PDF or HTML export that is not already cached cannot be generated and returns 503; a cached render stays downloadable. Renders are cached on disk per owner, document and version.

Building and running the sidecar is covered in [`../scripts/doc-render/README.md`](../scripts/doc-render/README.md).

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `HTML_DOCUMENTS_ENABLED` | Lets the assistant author HTML documents and offers PDF, HTML and Markdown downloads. Off, new HTML versions are refused but stored ones still display. |
| `CANVAS_ENABLED` | The export route answers 404 without it. |
| `DOC_RENDER_URL` | Address of the sidecar, for example `http://localhost:8791`. Both this and the flag must be set for PDF and HTML to be produced, so a flag that is on with no address is silently half off. |
| `DOC_RENDER_TIMEOUT_MS` | Wait ceiling per render. Default 60000. |
| `DOC_RENDER_CONCURRENCY` | Background renders in flight at once, for renders scheduled after a save. Default 2. On-demand export renders bypass this queue. |
| `DOC_RENDER_DEBOUNCE_MS` | Delay before rendering after a save. Default 2000. |
| `DOC_RENDERS_DIR` | Render cache directory. Default `/data/renders`. |
| `RENDER_HOST`, `RENDER_PORT`, `RENDER_MAX_BYTES`, `RENDER_NAV_TIMEOUT_MS` | Read by the sidecar itself, not the app. |

### Setup

1. Build and start the sidecar as described in its README, and keep it reachable only from Watanabe.
2. Set `DOC_RENDER_URL` and `HTML_DOCUMENTS_ENABLED=1`.

### Verify

Open a document in chat, download it as PDF, and confirm a PDF arrives. A 503 means the sidecar is not configured or not answering. The sidecar's `GET /health` returns `{"ok": true}`.

## Dictation

### What it does

Adds a microphone button to the chat composer. The browser records audio, `POST /api/dictate` forwards it to a speech-to-text backend, and the returned text is placed in the composer. The route never stores audio. The Anthropic API has no transcription endpoint, so a backend is required. A small on-device Whisper service is included.

Accepted audio types are `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-wav` and `audio/aac`. The upload is a multipart field named `audio`.

Setup, the model download and the HTTP contract are in [`../scripts/dictation-whisper/README.md`](../scripts/dictation-whisper/README.md).

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `DICTATION_ENABLED` | Feature flag. |
| `DICTATION_API_URL` | The backend URL the app POSTs the raw audio to. Required: with the flag on and no URL, the route answers 404. |
| `DICTATION_API_KEY` | Optional. Sent as `Authorization: Bearer <key>` to the backend. |
| `DICTATION_MAX_BYTES` | Upload cap. Default 10485760 (10 MB). Larger uploads get 413. |

The backend must answer a JSON body with a `text` string.

### Verify

With the backend running, `curl http://127.0.0.1:8790/health` (the bundled service) returns `ok`. In the app, record a short phrase with the composer microphone. A 503 from `/api/dictate` means the backend answered with an error status or returned no text. A network failure reaching the backend (for example a refused connection) surfaces as a 500.

## Personal LLM keys

### What it does

Lets staff create their own API keys for coding tools (Claude Code, Cursor, Cline, Codex, Continue), routed through your own gateway under token budgets. The pieces are:

- Watanabe stores key records, model groups, budgets and usage, and shows a per-tool setup snippet.
- A 9router instance (the `decolua/9router` image used in the gate README) holds the actual keys and talks to model providers. Watanabe creates and deletes keys on it through its admin API.
- The `llm-gate` sidecar sits in front of 9router. It checks each request's key, model group and remaining budget against a snapshot pulled from Watanabe, then streams the request through and reports token usage back.

How to build and run the gate, its environment variables and the 9router contract check are in [`../scripts/llm-gate/README.md`](../scripts/llm-gate/README.md).

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `LLM_KEYS_ENABLED` | Feature flag. Off, the settings and admin routes answer 404. |
| `LLM_ROUTER_URL` | The 9router admin endpoint. With `NINEROUTER_ADMIN_PASSWORD` it is required to create keys. |
| `NINEROUTER_ADMIN_PASSWORD` | 9router dashboard password. |
| `LLM_GATE_URL` | Where Watanabe tells the gate that something changed. |
| `LLM_GATE_SECRET` | Shared with the gate. The gate presents it in the `x-llm-gate-secret` header on `GET /api/internal/llm/snapshot` and `POST /api/internal/llm/usage`. Unset, those routes answer 501. |
| `LLM_PUBLIC_URL` | The public base URL of the gate, shown in each tool's setup snippet. |
| `ROUTER_URL`, `ROUTER_PASSWORD` | Read by the gate sidecar's contract script, not the app. |

### How it works for people and admins

- **Members** open Settings, LLM keys. They create a key with a label (up to 60 characters). The key is shown once. They can revoke it, see usage, and ask for more tokens (`/api/settings/llm-keys`, `/api/settings/llm-requests`). Any known member can do this.
- **Admins** open Admin, LLM budgets. They define model groups (a slug, a label, the models it covers with `*` as a wildcard, a default token allowance and a period of `day`, `week` or `month`), set budgets per user or per team, revoke a key or all of one person's keys, and approve or decline token requests (`/api/admin/llm/*`). Creating a key seeds a default group named `default` covering all models, with 5,000,000 tokens per day, only when no model group exists yet.

### Setup

1. Deploy 9router and the gate following the gate's README. The gate must reach the Watanabe service for the snapshot and usage routes.
2. Set `LLM_KEYS_ENABLED=1` and the five variables above on Watanabe. Use the same `LLM_GATE_SECRET` on the gate.
3. Expose the gate at `LLM_PUBLIC_URL`.

### Verify

Create a key at Settings, LLM keys, paste the shown snippet into a tool, and send a request. Usage should appear against the key. If key creation fails with an "unavailable" error, `LLM_ROUTER_URL` or `NINEROUTER_ADMIN_PASSWORD` is unset or 9router refused the request. The gate's own `/healthz` answers from the process alone.

## Product analytics

### What it does

Sends page views, interactions and errors to a PostHog instance that you run or subscribe to, so you can see how Watanabe is used. Behaviour taken from [`../components/analytics/analytics-provider.tsx`](../components/analytics/analytics-provider.tsx) and [`../lib/analytics/`](../lib/analytics/):

- People are identified by a pseudonymous id: the first 32 hex characters of the SHA-256 hash of the literal prefix `analytics:` followed by the email, never the address itself.
- The browser client masks all text and element attributes, keeps session recording disabled, honours the browser's Do Not Track setting, and captures unhandled errors with the page path.
- Server events and exceptions have anything that looks like an email address replaced with `<email>` before they are sent.
- When off, the browser code is not rendered at all.

### Flags and settings

| Setting | Meaning |
| --- | --- |
| `ANALYTICS_ENABLED` | Feature flag. |
| `POSTHOG_HOST` | The PostHog URL. |
| `POSTHOG_KEY` | A project key. It must look like `phc_` followed by at least 20 letters or digits, or it reads as unset. |

All three must hold, or nothing is sent.

### Setup and verify

Set the three values and reload the app. In PostHog's live events view you should see a pageview from a 32 character hex distinct id. If nothing arrives, confirm the key format and that `POSTHOG_HOST` is reachable from user browsers and from the server.

## Repository push webhook

### What it does

By default the app's checkout of the knowledge base refreshes at boot and, when `KB_WRITE_ENABLED` is on, on a timer (`REPO_REFRESH_INTERVAL_MS`, default 5 minutes). A GitLab push webhook makes a merge show up immediately: it refreshes the checkout, rebuilds the index (when `INDEX_ENABLED` is on), clears the link graph cache and updates any artifact waiting on review.

### Settings and setup

1. Set `REPO_REFRESH_WEBHOOK_SECRET` to a random string. Unset, the route answers 501 and does nothing.
2. In the GitLab project, add a webhook for push events pointing at `https://portal.example.com/api/repo/refresh`, with that string as the secret token. The route checks it in the `X-Gitlab-Token` header.

### Verify

Merge a change and watch it appear without a restart. A wrong token returns 401. The route is implemented only for GitLab's header ([`../app/api/repo/refresh/route.ts`](../app/api/repo/refresh/route.ts)). On GitHub, rely on the refresh interval (which runs only with `KB_WRITE_ENABLED` on).
