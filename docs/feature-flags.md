# Feature flags

Watanabe ships its optional subsystems behind feature flags: named `*_ENABLED` switches that an operator can set in the deployment environment and an administrator can override at runtime from the admin UI. This page explains how a flag resolves to on or off, what the "live" and "restart" effects mean, how dependencies are shown, and lists all 43 registered flags with the exact registry text. For the other environment variables see [environment.md](./environment.md).

## How a flag resolves

The check is `isFlagEnabled(envVar)` in [../lib/config/flags.ts](../lib/config/flags.ts). In order:

1. If `access/flags.yaml` contains an entry for the flag, that boolean wins, whether `true` or `false`.
2. Otherwise the flag is on only if the environment variable is exactly the string `1`. Any other value, including `true`, `yes` or unset, is off.

An override of `false` therefore turns a flag off even when the environment says `1`, and an override of `true` turns it on when the environment is unset.

Some features need more than the flag. For example, dictation also needs `DICTATION_API_URL`, and analytics also needs `POSTHOG_HOST` and a valid `POSTHOG_KEY`. Those conditions are noted in [environment.md](./environment.md).

## The override file: access/flags.yaml

Overrides are stored in `access/flags.yaml` on the private portal-memory branch. At runtime the file is read from `access/flags.yaml` under the memory checkout directory (`MEMORY_CHECKOUT_DIR`, see [environment.md](./environment.md)), through [../lib/repo-write-private-access.ts](../lib/repo-write-private-access.ts). The admin Flags tab writes it as a commit on that branch, so every change is recorded in the access history. It is not a file in your knowledge base vault.

The shape is a single `flags` map of flag name to boolean. The schema is strict: no other top-level keys, and values must be booleans.

```yaml
flags:
  MEMORY_ENABLED: true
  TASKS_ENABLED: true
  EXTERNAL_SHARE_ENABLED: false
```

Parsing rules, from `loadFlagOverrides`:

- A missing file is normal and means no overrides.
- Names that are not in the registry are dropped silently, so a retired flag left in an old commit does not invalidate the rest.
- A file that fails validation (a non-boolean value, an extra top-level key, bad YAML) is logged as an error and treated as empty. Every flag then falls back to its environment variable.
- The parsed file is cached against its modification time and size, so edits made outside the process (for example directly on the memory branch) are picked up without a restart. The admin UI also clears the cache on its own writes.

## Effect: live versus restart

Every registry entry carries an `effect`.

| Effect | Meaning |
| --- | --- |
| `live` | A saved override takes effect on the next check, with no restart. |
| `restart` | Part of the subsystem is wired up when the process boots, so a restart is needed for startup-only initialization. A saved override is still read by later flag checks (for example the permission gate) without a restart. |

The `restart` flags are `MEMORY_ENABLED`, `INDEX_ENABLED`, `PACKAGES_ENABLED`, `KB_WRITE_ENABLED` and `MEETINGS_ENABLED`. For these the Flags tab shows "Restart required", and shows "Pending restart" when the saved override differs from the environment variable's value. The comparison is against the environment, not the effective boot state, so the indicator can stay visible after a restart that already applied the override.

## Dependencies

A descriptor may name a `dependsOn` flag. This is presentation only ([../lib/config/flag-descriptor.ts](../lib/config/flag-descriptor.ts), and noted in [../lib/authority/config.ts](../lib/authority/config.ts)): in the Flags tab a flag whose dependency is off cannot be switched on and shows which flag to enable first, while switching it off is always allowed. The resolver itself does not enforce dependencies, so a dependent flag set to `1` with its dependency off is on as far as `isFlagEnabled` is concerned, and may do nothing in practice. Turn dependencies on first.

## The admin Flags tab

The Flags tab is part of the access administration page at `/admin/access`. It lists every registry entry with its description, the environment value, the saved override, and any dependency. Toggling a flag posts a `setFlag` change to `/api/access`, which rejects unknown flag names and requires the `manageAccess` capability. Turning `ROLES_ENABLED` off shows a warning, because it can remove access administration from admins who are not bootstrap admins (`BOOTSTRAP_ADMINS`).

## Registry

The registry is assembled in [../lib/config/flag-registry.ts](../lib/config/flag-registry.ts) from three files plus an operator file, which is empty in this distribution (`flags-operator.ts` exports no entries). Descriptions below are copied from the registry. The environment examples in [../.env.example](../.env.example) use shorter wording for some flags.

### flags-platform.ts

| Env var | Label | Effect | Depends on | Description |
| --- | --- | --- | --- | --- |
| `ANALYTICS_ENABLED` | Product analytics | live | none | Sends pageviews, interactions, and client-side errors to the self-hosted PostHog, keyed by a pseudonymous id rather than a person's address. No session recording. |
| `ACTIVITY_ENABLED` | Activity | live | none | Enables the combined activity feed and navigation entry. |
| `CANVAS_ENABLED` | Canvas | live | none | Enables in-chat documents, canvas tools, and the canvas pane. |
| `HTML_DOCUMENTS_ENABLED` | Designed documents | live | `CANVAS_ENABLED` | Lets the assistant author a document as a designed HTML page, and offers every document as PDF, HTML and Markdown. |
| `ATTACHMENTS_ENABLED` | Attachments | live | none | Allows thread-scoped file uploads for conversation context. |
| `DICTATION_ENABLED` | Dictation | live | none | Enables voice transcription when a dictation backend is configured. |
| `KB_ACCESS_UI_ENABLED` | KB access admin | live | `AUTHORITY_ENABLED` | Lets admins edit which groups can see a knowledge base file or folder from the tree. |
| `PEOPLE_ENABLED` | People directory | live | none | Names people from the private people directory instead of printing their email address. |
| `ALIASES_ADMIN_ENABLED` | Alias administration | live | `AUTHORITY_ENABLED` | Lets admins map a person's other email addresses to their portal identity from the members list. |
| `PEOPLE_ACTIVITY_ENABLED` | People | live | none | Enables the people activity view of who is doing what across meetings and tasks. |
| `CONNECTORS_ENABLED` | External MCP connectors | live | none | Admin-registered external MCP servers, clearance-tagged, per-thread opt-in. |
| `CONNECTOR_OAUTH_ENABLED` | Connector OAuth | live | `CONNECTORS_ENABLED` | Per-user OAuth connections for external MCP connectors, the runtime kill switch for the connect flow, credential reads and bearer injection. |
| `SKILLS_ENABLED` | Installable skills | live | none | Admin-installed Agent Skills, clearance-tagged, loaded into chat sessions. |
| `RICH_EDITOR_ENABLED` | Rich editor | live | none | Offers a WYSIWYG alternative to the raw markdown source when editing a document body. |
| `MEETINGS_WEBHOOK_ENABLED` | Circleback webhook ingestion | live | `MEETINGS_ENABLED` | Accepts signed Circleback webhook deliveries, so meetings recorded by other workspace members can be ingested. |
| `KB_REVIEW_ENABLED` | KB review queue | live | none | Shows approvers the knowledge base changes waiting on review, and lets them merge or reject one. |
| `KB_DELETE_ENABLED` | KB delete | live | `KB_WRITE_ENABLED` | Lets an admin propose removing a knowledge base note, as a reviewable change in the review queue. |
| `DOC_COPILOT_ENABLED` | Doc copilot | live | `DOC_ANNOTATIONS_ENABLED` | A chat panel on shared documents whose assistant proposes edits as suggestions for human review. It never edits the body or accepts anything itself. Off, the panel and its tools are dark. |
| `USAGE_AUDIT_ENABLED` | Usage audit | live | none | Records model usage and cost per turn and shows the ledger to administrators. |
| `LLM_KEYS_ENABLED` | Personal LLM keys | live | none | Lets staff create their own LLM keys for coding harnesses, routed through 9router behind token budgets that administrators set per model group, team and person. |

### flags-workspace.ts

| Env var | Label | Effect | Depends on | Description |
| --- | --- | --- | --- | --- |
| `TASKS_ENABLED` | Tasks | live | none | Enables task extraction, task APIs, and task views. |
| `TASK_COMMENTS_ENABLED` | Task comments | live | `TASKS_ENABLED` | Enables discussion on tasks: a comment list on the task, a count on the cards, and comment activity in What's New. |
| `ROLES_ENABLED` | Roles | live | none | Enforces role-based capabilities for contributors and administrators. |
| `PROJECTS_ENABLED` | Projects | live | none | Enables project workspaces and project context in conversations. |
| `ARTIFACTS_ENABLED` | Artifacts | live | none | Enables saved artifacts and artifact publishing controls. |
| `SHARED_DOCS_ENABLED` | Shared documents | live | none | Enables shared document creation, collaboration, and views. |
| `EXTERNAL_SHARE_ENABLED` | External sharing | live | `SHARED_DOCS_ENABLED` | Allows signed unauthenticated links to shared documents. |
| `DOC_ANNOTATIONS_ENABLED` | Document annotations | live | `SHARED_DOCS_ENABLED` | Enables anchored comment threads and proposed edits on shared documents. |
| `DOC_GROUP_SHARING_ENABLED` | Team sharing | live | `SHARED_DOCS_ENABLED` | Lets a document be shared with a whole team, tracking that team's membership. Off, existing team grants stop resolving and only per-person shares apply. |
| `SHARED_DOC_PUBLISH_ENABLED` | Publish shared documents | live | `SHARED_DOCS_ENABLED` | Lets a document owner submit a shared document to the knowledge base as a reviewable change. Off, a shared document's only disposition is who it is shared with. |
| `MCP_ENABLED` | Workspace MCP | live | none | Serves /api/mcp to members with an MCP client, and runs the OAuth authorization server that lets one register itself. Each domain's tools follow that domain's own flag, so turning a feature off turns its tools off. Off, the endpoint and its discovery documents refuse. |
| `DOC_IMPORT_ENABLED` | Import documents | live | `SHARED_DOCS_ENABLED` | Lets a person drop a Markdown or Word file onto their shared documents to import it. Off, a document can only be created by typing into the create dialog. |
| `DOC_ACCESS_REQUESTS_ENABLED` | Request document access | live | `SHARED_DOCS_ENABLED` | Shows a person who opens a document they are not on a "You need access" screen they can ask the owner from, instead of a bare not-found. Off, the document is not found and no request can be made. |
| `KB_PROPOSE_EDIT_ENABLED` | Propose an edit | live | `KB_WRITE_ENABLED` | Lets a contributor open a draft edit of a knowledge base note, which lands as a reviewable change. The note's own visibility is always carried through unchanged. |

### flags-knowledge.ts

| Env var | Label | Effect | Depends on | Description |
| --- | --- | --- | --- | --- |
| `MEMORY_ENABLED` | Memory | restart | none | Stores and recalls durable agent memory from the private memory branch. |
| `INDEX_ENABLED` | Index | restart | none | Builds and serves the generated knowledge base index. |
| `KB_GRAPH_ENABLED` | KB graph | live | none | Shows the knowledge base link graph as a tab on the vault map. |
| `QUALITY_GATES_ENABLED` | Quality gates | live | `KB_WRITE_ENABLED` | Runs automated quality checks before knowledge base submissions. |
| `INTEGRITY_ENABLED` | Integrity check | live | `QUALITY_GATES_ENABLED` | Flags duplicate or contradicting content against the rest of the knowledge base at submit time. |
| `PACKAGES_ENABLED` | Packages | restart | `KB_WRITE_ENABLED` | Accepts and processes update packages through the write path. |
| `KB_WRITE_ENABLED` | Knowledge base writes | restart | none | Enables reviewable knowledge base edit and submission tools. |
| `AUTHORITY_ENABLED` | Authority | live | none | Applies group clearance to knowledge base reads and administration. |
| `MEETINGS_ENABLED` | Meetings | restart | `KB_WRITE_ENABLED` | Enables meeting ingestion, processing, and meeting views. |


### flags-operator.ts

Empty. It exists as an extension point for operator specific flags and exports an empty list.

## Enabling a flag

Set the variable to `1` in the deployment environment:

```bash
MEMORY_ENABLED=1
KB_WRITE_ENABLED=1
```

or toggle it from the Flags tab, which writes the override described above. For `restart` flags, restart the deployment afterwards.
