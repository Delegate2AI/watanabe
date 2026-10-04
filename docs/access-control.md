# Access control

This document explains who can see and do what in Watanabe. It covers the access files, administrators, groups and clearance on knowledge base content, roles and approvers for the review queue, document sharing, how the bot identities are treated, and how changes take effect. Authentication, meaning how a request gets an email address in the first place, is covered in [authentication](./authentication.md).

## The model in one page

Three independent mechanisms decide access.

| Mechanism | Question it answers | Where it is defined |
|---|---|---|
| Clearance (groups) | Which knowledge base notes can this person read? | `access/groups.yaml` plus a `visibility` field in each note |
| Roles | Can this person write, approve change requests, or administer access? | `access/roles.yaml` |
| Document shares | Who can open this one shared document? | Per-document rows in the portal database |

Clearance and roles are switched on by feature flags (`AUTHORITY_ENABLED` and `ROLES_ENABLED`). Both are described below, including what happens when they are off.

## Where the access files live

The access files are not read from the `access/` directory of the application source tree. The running portal reads them from a checkout of a separate branch named `portal-memory`, in the same git repository as the knowledge base (`../lib/memory/repo-memory.ts`, `../lib/authority/config.ts`). The branch is created automatically and holds no knowledge base history. The `access/roles.yaml` file shipped in the source tree is a starting example only and is not read at runtime.

| Setting | Meaning |
|---|---|
| `MEMORY_ENABLED=1` | The portal clones, or creates and seeds, the `portal-memory` checkout at startup |
| `REPO_WRITE_TOKEN` | Required to push to that branch |
| `MEMORY_CHECKOUT_DIR` | Where the checkout lives. Defaults to `/data/memory` |
| `MEMORY_ORIGIN_OVERRIDE` | Use this git remote for the branch instead of the knowledge base remote |

You can edit the files two ways: through the admin screens (which commit to the branch for you, authored as the acting admin), or by committing to the `portal-memory` branch directly with your git host. The files are not in the vault, so they are never published to readers as notes.

Files the portal recognizes under `access/` on that branch (`../lib/repo-write-private-access.ts`):

| File | Purpose |
|---|---|
| `groups.yaml` | Group membership, which drives clearance |
| `roles.yaml` | Role membership and the default role |
| `flags.yaml` | Runtime overrides for feature flags |
| `people.yaml` | Display names. Presentation only |
| `aliases.yaml` | Extra email addresses that map to one person |
| `connectors.yaml`, `skills.yaml`, `design-guide.md` | Used by connectors, skills and design-guide features. Not covered here |

Only the first five are described below. A malformed file is logged and treated as empty, so check the logs after editing by hand. An empty `groups.yaml` means nobody belongs to any group.

## Schemas

### groups.yaml

```yaml
groups:
  all-hands:
    - ada@example.com
  engineering:
    - ada@example.com
    - grace@example.com
```

A map from group name to a list of email addresses. Addresses are lowercased on load. Admin-screen group names must match `^[a-z0-9][a-z0-9-]*$`. The file is validated as a whole, so a bad email address in one group makes the entire file load as empty.

Two names are special:

- `all-hands` is implicit. Every signed-in person has it whether or not it is listed, and it never needs to be declared for read clearance. Assigning `all-hands` through the admin visibility editor does require it to be declared in `groups.yaml`.
- `admins` is a group whose members are administrators for clearance purposes (see below).

### roles.yaml

```yaml
roles:
  admin:
    - ada@example.com
  approver:
    - grace@example.com
  editor: []
  viewer: []
default: viewer
```

Under `roles` the only allowed keys are `viewer`, `editor`, `approver` and `admin` (any other key fails validation), each a list of emails. `default` is required and must be `viewer` or `editor`. It is the role of anyone not listed. If someone is listed under several roles, the highest wins.

| Role | Capabilities |
|---|---|
| `viewer` | None |
| `editor` | `write` |
| `approver` | `write`, `approve` |
| `admin` | `write`, `approve`, `manageAccess`, `triggerIngest` |

`manageAccess` gates the admin endpoints for groups, roles, flags, aliases, display names and MCP tokens.

### flags.yaml

```yaml
flags:
  KB_REVIEW_ENABLED: true
  DOC_GROUP_SHARING_ENABLED: true
```

Booleans keyed by flag name. An override beats the environment variable. Names that are not known flags are dropped without invalidating the rest. See "Feature flags" below.

### people.yaml and aliases.yaml

```yaml
people:
  ada@example.com:
    name: Ada Example
    title: Engineer
    source: manual
```

`people.yaml` maps an email to a display name, an optional title, and a `source` of `idp` (recorded from the name your identity provider sends, the default) or `manual` (set by an admin, and never overwritten by a later sign-in). It affects only how people are named. A broken file cannot affect clearance.

```yaml
aliases:
  ada@example.com:
    - ada.personal@example.net
```

`aliases.yaml` maps one canonical address to other addresses the same person uses, for example the personal address that appears as a meeting attendee. Unlike `people.yaml` it affects access: groups, roles and membership are all evaluated on the canonical address, on both sides of the comparison. An alias that is not a valid email, or that is also a canonical key, is ignored. The admin alias editor needs `ALIASES_ADMIN_ENABLED` and `AUTHORITY_ENABLED`.

## Administrators

There are three separate ways to be an administrator, and they are not the same thing.

| Source | Effect |
|---|---|
| `BOOTSTRAP_ADMINS` environment variable (comma separated emails) | Full admin capabilities in every case, regardless of `roles.yaml` or `ROLES_ENABLED`. Use it to get the first admin in |
| `admin` in `roles.yaml` | The admin role, effective when `ROLES_ENABLED=1` |
| Membership of the `admins` group in `groups.yaml` | Reads every note regardless of its `visibility`, and sees notes whose frontmatter cannot be parsed |

The admin screens refuse to save a change that would leave no admin: the result must contain at least one `admin` in `roles.yaml` or at least one valid address in `BOOTSTRAP_ADMINS`. To make someone a full administrator who can also read everything, put them in both `roles.yaml` (admin) and the `admins` group.

## Clearance on knowledge base content

Clearance applies when `AUTHORITY_ENABLED=1`. With it off, everyone is treated as having only `all-hands` and no filtering is applied to reads.

### How a note maps to groups

Clearance is set per note, in the note's YAML frontmatter, not by folder path (`../lib/authority/visibility.ts`):

```markdown
---
title: Hiring plan
visibility:
  - leadership
  - hr
---
```

- `visibility` may be a single string or a list of group names.
- A note with no `visibility`, or an empty one, is `all-hands`.
- A person can read the note if they hold at least one of the listed groups. An admin (member of the `admins` group) reads everything.
- A note whose frontmatter cannot be parsed, or whose `visibility` is neither a string nor a list of strings, is visible only to admins.

A person's clearance is `all-hands` plus every group in `groups.yaml` that contains their canonical address.

Directories do not carry visibility of their own. The admin tree control that sets visibility on a folder (requires `KB_ACCESS_UI_ENABLED`, which depends on `AUTHORITY_ENABLED`) rewrites the `visibility` field of every note under that folder and submits the result through the write path (`KB_WRITE_MODE`). In `mr` mode that pushes a `kb/...` branch and opens a change request through the git host, returning its URL. If the host refuses to open it, the control answers `review_unavailable` (HTTP 502) and the pushed branch is kept, so open the change request on the host. In `direct` mode it pushes to `main`. A note it cannot rewrite, for lack of parseable frontmatter, is skipped and reported.

### How reads are enforced

For each distinct clearance set, the portal builds a filtered copy of the vault (a projection) that contains only the notes that set may read, plus the assets those notes reference, with links to removed notes dropped (`../lib/authority/projection.ts`). Search, the file tree, the chat agent and the MCP tools read from the projection that matches the caller. Projections are cached and rebuilt when the vault revision or `groups.yaml` or `roles.yaml` changes.

## Approvers and the review queue

The review queue at `/review` lists open change requests for the knowledge base so approvers can accept or reject them without leaving the portal. It needs `KB_REVIEW_ENABLED=1` and `REPO_WRITE_TOKEN` (`../lib/review/queue.ts`, `../app/api/review/route.ts`).

- Only people with the `approve` capability can use it, which means the `approver` or `admin` role. If `ROLES_ENABLED` is off, every signed-in person has `write` and `approve`.
- A change request appears only if it touches nothing outside the vault, so changes to other repository paths are reviewed on your git host instead.
- A change request is shown only if the reviewer is cleared for every note it touches. One note outside the reviewer's clearance hides the whole request. A new note with no frontmatter cannot be cleared, so the proposal is hidden from every reviewer except members of the `admins` group, who are authorized before visibility is checked. For a modified, renamed or deleted note, the visibility on the main branch is used.
- A change request whose diff the git host truncated is skipped, because its paths cannot be authorized.
- A change request the reviewer is not cleared for answers the same as one that does not exist.
- Approving merges the change request. The queue sends the head commit it displayed. If the branch has moved since, the merge is refused.

The agent that proposes changes never merges on its own. In the default `mr` mode every agent or publish edit lands as a change request that a human with the right role approves. A submitter with the `approve` capability can use `direct` mode, which pushes to `main` without one (see [knowledge-base.md](./knowledge-base.md)).

## Roles and writing

With `ROLES_ENABLED=1`, the `write` capability (`editor`, `approver`, `admin`) controls who can propose knowledge base edits. Writing through the chat agent also needs `KB_WRITE_ENABLED=1`. With roles off, `KB_WRITE_ENABLED` alone decides, and any signed-in person can write and approve. The admin visibility editor does not use `KB_WRITE_ENABLED`: it needs the `manageAccess` capability, `AUTHORITY_ENABLED`, `KB_ACCESS_UI_ENABLED` and a write token.

## Document sharing

Shared documents are separate from the knowledge base. A document is accessible to its owner, to anyone it is explicitly shared with, and to holders of a valid link. Sharing needs `SHARED_DOCS_ENABLED=1` (`../lib/shared-docs/access.ts`, `../app/api/docs/[id]/shares/route.ts`).

| Access level | Can |
|---|---|
| `view` | Read the current version |
| `comment` | View and comment |
| `edit` | View, comment and add new versions |
| owner | All of the above, plus manage shares and links, and delete |

- The owner shares with a person (an email address) or, with `DOC_GROUP_SHARING_ENABLED=1`, with a group named in `groups.yaml`. A person's effective level is the highest of: owner, their own share, and any group share for a group they belong to.
- Clearance alone never grants access to a document. A group share applies only when the owner wrote a share row naming that group. Being in a group does not reach a document nobody shared with it, and sharing a document does not make a knowledge base note readable.
- The group must exist in `groups.yaml` (`all-hands` always counts), and the owner can only share with groups they are themselves in. Admins can share with any declared group. The owner cannot share with themselves.
- With group sharing off, existing group shares stop resolving and only per-person shares apply. Revoking a share keeps working even if the group was since removed.
- Signed links for people without an account need `EXTERNAL_SHARE_ENABLED=1`. A link carries `view` or `comment`, never `edit`, and can expire.
- A stranger and an unknown document id get the same `404`, so a document's existence is not revealed. The exception is `DOC_ACCESS_REQUESTS_ENABLED`: when it is on, an existing document the reader cannot access shows an access-request screen, while an unknown id still answers `404`.

Per-user private documents and promotion to the knowledge base follow the dispositions described in the [README](../README.md). Promotion goes through the same write path as any other knowledge base edit: a change request in `mr` mode, or a direct push to `main` when an approver publishes in `direct` mode.

## Bot identities

Two addresses in `portal.yaml` identify the portal's own unattended git work (`../lib/config/schema.ts`):

```yaml
git:
  botName: "Watanabe Portal Bot"
  botEmail: "portal-bot@watanabe.local"
  memoryEmail: "portal-memory@watanabe.local"
```

| Key | Used for | Access treatment |
|---|---|---|
| `git.botEmail` | Committer of every portal-made knowledge base commit, author of unattended ones (for example meeting ingestion), and the default actor for people-directory writes | Treated as an administrator by role checks (`admin` capabilities, regardless of `ROLES_ENABLED`) |
| `git.memoryEmail` | Author of commits that seed the `portal-memory` branch | A git author identity only. It is not given any role |

Neither address is a real identity provider login, so neither can sign in. The match is on that exact address, and `portal.yaml` is read once at startup, so a changed `botEmail` takes effect after a restart. Keep it distinct from every address that can sign in, because anyone who authenticates as that address would be an administrator.

## Feature flags and defaults

| Flag | Effect on access |
|---|---|
| `AUTHORITY_ENABLED` | Applies group clearance to knowledge base reads. Off: everyone has only `all-hands` and nothing is filtered. Also required for group admin, `KB_ACCESS_UI_ENABLED` and `ALIASES_ADMIN_ENABLED` |
| `ROLES_ENABLED` | Enforces roles. Off: any signed-in person can write and approve, and only bootstrap admins and the bot hold `manageAccess` |
| `KB_ACCESS_UI_ENABLED` | Admin control for setting note and folder visibility |
| `ALIASES_ADMIN_ENABLED` | Admin editing of aliases |
| `KB_REVIEW_ENABLED` | The review queue |
| `SHARED_DOCS_ENABLED`, `DOC_GROUP_SHARING_ENABLED`, `EXTERNAL_SHARE_ENABLED` | Document sharing, team sharing, signed links |

Flags are read from `access/flags.yaml` first, then from the environment variable being `1` (`../lib/config/flags.ts`). The admin Flags tab writes `flags.yaml`.

## How changes take effect

What the code confirms:

- `flags.yaml`, `roles.yaml` and `aliases.yaml` are cached against the file's modification time and size. An edit on the checkout, including one that arrives by git, is picked up on the next read without a restart. Edits made through the admin screens invalidate the cache immediately.
- `groups.yaml` is read from disk on each lookup, so group membership changes apply to the next request.
- Filtered vault copies are keyed on the group and role files, so a membership change leads to a new copy being built for the affected clearance sets.
- The portal refreshes its `portal-memory` checkout (a fetch and hard reset) at startup when memory is enabled. Before it writes access files it fetches and rebases the checkout onto the remote branch. Edits made through the access admin screen (groups, roles, flags) are computed again from the rebased files, so an edit made on the git host is kept. The other private-access writers (people directory, skills, connectors) write contents prepared before the rebase.
- A running chat session fixes the user's clearance and flags when it starts. Changes made through the admin API (`POST /api/access`) evict all warm chat sessions so the next message rebuilds them with the new values. Out-of-band edits do not trigger this eviction.
- Changes to `git.botEmail` and other `portal.yaml` keys take effect on restart.

## Worked example: a small organization

Example Co has five people. Ada runs the company, Grace leads engineering and approves knowledge base changes, Linus and Margaret are engineers, and Alan handles finance.

Deployment settings:

```bash
AUTHORITY_ENABLED=1
ROLES_ENABLED=1
KB_WRITE_ENABLED=1
KB_REVIEW_ENABLED=1
KB_ACCESS_UI_ENABLED=1
SHARED_DOCS_ENABLED=1
DOC_GROUP_SHARING_ENABLED=1
MEMORY_ENABLED=1
REPO_WRITE_TOKEN=...
BOOTSTRAP_ADMINS=ada@example.com
```

`access/groups.yaml` on the `portal-memory` branch:

```yaml
groups:
  admins:
    - ada@example.com
  leadership:
    - ada@example.com
    - grace@example.com
  engineering:
    - grace@example.com
    - linus@example.com
    - margaret@example.com
  finance:
    - ada@example.com
    - alan@example.com
```

`access/roles.yaml`:

```yaml
roles:
  admin:
    - ada@example.com
  approver:
    - grace@example.com
  editor:
    - linus@example.com
    - margaret@example.com
    - alan@example.com
default: viewer
```

`access/flags.yaml` (optional, only to override environment values):

```yaml
flags:
  KB_REVIEW_ENABLED: true
```

`access/aliases.yaml` (Linus also appears under a personal address in meeting invites):

```yaml
aliases:
  linus@example.com:
    - linus.personal@example.net
```

`access/people.yaml`:

```yaml
people:
  ada@example.com:
    name: Ada Example
    source: manual
  grace@example.com:
    name: Grace Example
    source: manual
```

Three notes in the vault:

```markdown
---
title: Company handbook
---
```

```markdown
---
title: Payroll runbook
visibility:
  - finance
---
```

```markdown
---
title: Architecture decisions
visibility:
  - engineering
  - leadership
---
```

What each person experiences:

| Person | Clearance | Role | Handbook | Payroll runbook | Architecture decisions |
|---|---|---|---|---|---|
| Ada | all-hands, admins, finance, leadership | admin | read | read | read |
| Grace | all-hands, engineering, leadership | approver | read | no | read |
| Linus | all-hands, engineering | editor | read | no | read |
| Margaret | all-hands, engineering | editor | read | no | read |
| Alan | all-hands, finance | editor | read | read | no |

- Linus signing in as `linus.personal@example.net` resolves to `linus@example.com`, so he keeps his group and role.
- When Linus proposes an edit to Architecture decisions, the change request appears in Grace's review queue, because she is an approver cleared for `engineering` and `leadership`. It does not appear for Alan, who is not an approver, and would stay hidden even from an approver who held neither group.
- A change request that touches the Payroll runbook is visible in the queue only to approvers who also hold `finance` or are in the `admins` group. Here that is Ada.
- Alan shares a draft with the `finance` group. Ada sees it because she is in `finance`. He cannot share with `engineering`, because he is not in it.
- Removing Alan from every group in `groups.yaml` stops his MCP tokens from working as well, because tokens require known membership.

## Related

- [Authentication](./authentication.md)
- [Integrations](./integrations.md)
- [portal.example.yaml](../portal.example.yaml)
