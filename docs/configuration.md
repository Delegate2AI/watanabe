# Configuration reference (portal.yaml)

`portal.yaml` is the structured configuration file for a Watanabe deployment: branding, the knowledge base location, agent house rules, git identities, embedding, authentication, and the skills marketplace. This page covers where the file is loaded from, how values are resolved, and every key the schema accepts. Settings that are plain switches or secrets live in environment variables instead; see [environment.md](./environment.md) and [feature-flags.md](./feature-flags.md). A commented starting point is in [../portal.example.yaml](../portal.example.yaml).

## Loading

The loader is [../lib/config/load.ts](../lib/config/load.ts). The file is optional: with no file, every key takes its default and the portal behaves with proxy-header auth and the neutral Watanabe branding.

| Step | Behaviour |
| --- | --- |
| Discovery | `PORTAL_CONFIG` if set and non-empty (resolved against the working directory), otherwise `./portal.yaml` in the working directory, otherwise no file. |
| Missing explicit path | If `PORTAL_CONFIG` points at a file that does not exist, boot fails. It is treated as a typo, not as "use defaults". |
| Parse | YAML. An empty document is treated as `{}`. Parse errors name the file and include the line and column. |
| Interpolation | `${VAR}` references are resolved from the environment (see below). |
| Validation | The zod schema in [../lib/config/schema.ts](../lib/config/schema.ts). Every object is strict: an unknown key is an error, so a typo such as `auth.mod` fails loudly instead of leaving the default in place. Errors are printed as `path: message` lines. |
| Environment overrides | Applied after validation (see Precedence). |
| Guards | The no-auth guard and the OIDC completeness check run last. |

The configuration is read once at process start. `instrumentation.ts` loads it before anything else on the Node.js runtime, and a bad file stops the process rather than degrading it. Changing `portal.yaml` therefore needs a restart.

### Precedence

Lowest to highest: built-in defaults, then `portal.yaml`, then environment variables.

Only three values have an environment override. Everything else in `portal.yaml` has no environment equivalent.

| Environment variable | Overrides | Notes |
| --- | --- | --- |
| `LOCAL_REPO_PATH` | `repo.path` | A non-empty value (after trimming) wins. |
| `VAULT_SUBDIR` | `repo.vaultSubdir` | Presence is tested, not truthiness: `VAULT_SUBDIR=""` is meaningful and means the repository root is the vault. |
| `PORTAL_PROXY_ASSERT_SECRET` | `auth.proxyHeader.assertSecret` | Applies only when `auth.mode` is `proxy-header` and the variable is non-empty. |

### Variable interpolation

Any string value in the file may contain `${VAR}`. Rules, from [../lib/config/interpolate.ts](../lib/config/interpolate.ts):

- References are resolved after YAML parsing and before validation, in every string, including strings inside lists. Numbers, booleans and null are untouched.
- A referenced variable that is unset or empty is a boot error that names the config path and the variable. Use this to keep secrets out of a committed file.
- `$${VAR}` is an escape and produces the literal text `${VAR}`.
- Substitution is single pass. If a variable's value itself contains `${...}`, that text is kept literally and is not looked up again.
- Because an unset reference fails the boot, do not leave a `${VAR}` in a key you are not using. In particular the example file's `repo.path: ${LOCAL_REPO_PATH}` and `assertSecret: ${PORTAL_PROXY_ASSERT_SECRET}` lines require those variables to be set. Delete the line, or set the variable, when you copy the example.

### Build time versus runtime

Everything is read at process start (runtime), with one exception: `embed.frameAncestors` is also read by [../next.config.ts](../next.config.ts), which calls `loadEmbedConfig()` and bakes the value into the `Content-Security-Policy: frame-ancestors ...` header for `/embed`. Changing it requires a rebuild of the image, not only a restart. `loadEmbedConfig()` validates only the `embed` block, but still resolves `${VAR}` in it, so those variables must be present at build time.

### Browser exposure

The full configuration never reaches the browser. [../lib/config/public.ts](../lib/config/public.ts) builds the only client-visible shape by naming fields explicitly: `app.name`, `app.tagline`, `app.navLabel`, `app.composerPlaceholder`, `app.feedbackUrl` (when set), `app.starters`, plus the change request wording for the configured git host. `app.kbDescription`, the `agent` block, `git`, `embed`, `auth` and `skills` are server only.

## Top-level keys

Allowed top-level keys: `repo`, `app`, `agent`, `git`, `embed`, `auth`, `skills`. Anything else fails validation.

## repo

| Key | Type | Default | Controls |
| --- | --- | --- | --- |
| `path` | string | unset | Path to a local checkout of the knowledge base, resolved against the working directory. Equivalent to `LOCAL_REPO_PATH`, which wins if both are set. It is honoured only when `REPO_READ_TOKEN` is unset, so a config file cannot disable the managed clone in a deployment that has a read token ([../lib/repo.ts](../lib/repo.ts)). |
| `vaultSubdir` | string | `"docs"` | The vault directory inside the repository. `"."` or `""` means the repository root is the vault. `VAULT_SUBDIR` wins if set. |

## app

The whole block may be omitted.

| Key | Type | Default | Controls |
| --- | --- | --- | --- |
| `name` | string, non-empty | `Watanabe` | Product name shown in the UI. Also logged at boot. |
| `tagline` | string | `Your team's knowledge workspace` | Tagline shown in the UI. |
| `navLabel` | string, non-empty | `Knowledge base` | Label for the knowledge base entry in navigation. |
| `kbDescription` | string | `the team knowledge base` | Names the knowledge base in the agent's system prompt and sign-in walls. Server only. Reads best as a noun phrase beginning with "the". |
| `feedbackUrl` | string, optional | unset | Target of the help dialog's "Send feedback" link. Must start with `mailto:`, `http://` or `https://`. When unset the link is not rendered. |
| `composerPlaceholder` | string | `Ask anything about your knowledge base...` | Placeholder text in the chat composer. |
| `starters` | list of starter cards | four built-in cards (below) | Empty-state cards. Clicking one prefills the composer and does not send. An empty list is valid and removes the configured cards; a page-context card (when the app is embedded with page context) and a content card (when short-form content is available) can still appear. A list you provide replaces the defaults entirely. |

Each starter card is strict and all five fields are required.

| Key | Type | Notes |
| --- | --- | --- |
| `id` | string, non-empty | Stable identifier. |
| `label` | string, non-empty | Card title. |
| `sub` | string | Subtitle (may be empty). |
| `icon` | enum | One of `BookOpen`, `Coins`, `Layers`, `GitBranch`, `Gauge`, `Scale`, `Map`, `Shield` ([../lib/config/icons.ts](../lib/config/icons.ts)). An unknown name is a boot error. |
| `prompt` | string, non-empty | Text placed in the composer. A trailing space lets the user continue typing. |

The built-in defaults have ids `whats-in-the-kb`, `recent-changes`, `draft-a-document` and `find-a-decision`.

## agent

All keys optional. They tailor the assistant's prompts to your organization.

| Key | Type | Default | Controls |
| --- | --- | --- | --- |
| `houseRules` | list of non-empty strings | `[]` | Editorial rules. Each entry becomes one bullet under a "HOUSE RULES" heading in the agent's system prompt. Empty omits the block and the later references to it. |
| `houseRulesSummary` | string | `""` | Short phrase appended in parentheses to the sentence that tells the agent its drafts must follow the house rules. Used only when `houseRules` is non-empty. |
| `subjectName` | string | `""` | Name of the thing the knowledge base covers. Prefixes descriptions such as "the Acme knowledge base" in agent permission messages, the KB MCP server description, change request text and package prompts, and is used in the "prefer the knowledge base first for anything about X itself" line. Empty drops the prefix. |
| `memoryRules` | list of non-empty strings | `[]` | Rules written under "House rules (always apply)" in the `memory/CLAUDE.md` that governs the memory worktree. Written when the memory branch is first seeded ([../lib/memory/repo-memory.ts](../lib/memory/repo-memory.ts)), so an existing memory branch is not rewritten by a config change. Empty omits the section. |
| `memoryRulesSummary` | string | `""` | Phrase appended to the writing-discipline reminder in the memory consolidation prompt ([../lib/memory/dream.ts](../lib/memory/dream.ts)). |

```yaml
agent:
  houseRules:
    - "Always write the product name in full."
    - "Never promise delivery dates."
  houseRulesSummary: "product name, delivery dates"
  subjectName: "Your Org"
  memoryRules:
    - "Always write the product name in full."
  memoryRulesSummary: "product name"
```

## git

Identities used for unattended commits. All three are non-empty strings. The git host itself (GitHub or GitLab) is not set here: it comes from the `GIT_HOST` environment variable, see [environment.md](./environment.md).

| Key | Default | Controls |
| --- | --- | --- |
| `botName` | `Watanabe Portal Bot` | Committer name for commits the portal makes (change request branches, meeting imports). Contributor submissions carry the contributor as author. Meeting imports also use it as author. |
| `botEmail` | `portal-bot@watanabe.local` | Committer email for those commits, and the author email for meeting imports. The authority layer also treats this address as the implicit admin ([../lib/authority/roles.ts](../lib/authority/roles.ts)), so changing it changes who counts as the bot once the process restarts. |
| `memoryEmail` | `portal-memory@watanabe.local` | Author email for commits to the memory branch. |

## embed

| Key | Type | Default | Controls |
| --- | --- | --- | --- |
| `frameAncestors` | string, non-empty | `'self' http://localhost:*` | Value of the CSP `frame-ancestors` directive on `/embed`: the origins allowed to frame it. A space separated source list. Read at build time (see above). |

## auth

`auth.mode` selects how identity is established. Only the block named by `mode` may be present: a block for a different mode is rejected with an "Unrecognized key" error, so remove inactive blocks when you switch modes. If `auth` is omitted entirely the result is `mode: proxy-header` with all proxy header defaults.

How each mode behaves at runtime is documented in [authentication.md](./authentication.md), and the self-hosted login flow in [oidc-auth-mode.md](./oidc-auth-mode.md). This section lists keys only.

| `mode` | Block | Summary |
| --- | --- | --- |
| `proxy-header` (default) | `proxyHeader` | Identity injected by a reverse proxy in front of the app. |
| `jwt` | `jwt` | The portal verifies a signed token itself. |
| `none` | `none` | No authentication. Local development only. |
| `oidc` | `oidc` | The portal performs an OIDC login. |

### auth.proxyHeader

| Key | Default | Controls |
| --- | --- | --- |
| `emailHeader` | `X-Auth-Request-Email` | Header carrying the user's email. |
| `userHeader` | `X-Auth-Request-User` | Header carrying the user name. |
| `assertHeader` | `X-Portal-Proxy-Assert` | Header the proxy sets to prove the request came through it. |
| `assertSecret` | unset | Expected value of `assertHeader`. When unset the identity headers are trusted unverified and a warning is logged once per process. `PORTAL_PROXY_ASSERT_SECRET` overrides it. |

### auth.jwt

`algorithm` is required and selects one of two shapes. Each shape forbids the other's key.

| Key | Applies to | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `algorithm` | both | `RS256` or `HS256` | required | |
| `jwksUrl` | RS256 only | URL | required for RS256 | JWKS endpoint. Forbidden with HS256. |
| `secret` | HS256 only | string, non-empty | required for HS256 | Shared secret. Forbidden with RS256. Use `${VAR}`. |
| `issuer` | both | string, non-empty | required | Expected `iss`. |
| `audience` | both | string, non-empty | required | Expected `aud`. |
| `source` | both | `cookie` or `bearer` | `cookie` | Where the token is read from. |
| `cookieName` | both | string, non-empty | `portal_session` | Cookie name when `source` is `cookie`. |
| `emailClaim` | both | string, non-empty | `email` | Claim holding the email. |
| `nameClaim` | both | string, non-empty | `name` | Claim holding the display name. |

### auth.none

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `email` | email | required | Identity assigned to every request. |
| `name` | string | unset | Display name. |

The mode refuses to start unless `PORTAL_ALLOW_NO_AUTH=1` is set in the environment, so a `portal.yaml` that reaches a production image cannot disable authentication by itself. A warning is logged at every boot in this mode.

### auth.oidc

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `provider` | `google`, `logto` or `generic` | `google` | |
| `issuer` | URL | unset | Required for `logto` and `generic`. Must not be set for `google`, whose issuer is fixed. Must be https, or a loopback host. |
| `clientId` | string, non-empty | required | OAuth client id. |
| `baseUrl` | URL | required | Absolute origin of this portal, from which the redirect URI is derived. Must be https, or a loopback host. |
| `allowedDomains` | list of strings | `[]` | Admitted email domains. |
| `allowedEmails` | list of emails | `[]` | Admitted individual emails. |
| `scopes` | list of strings | `["openid", "email", "profile"]` | Requested scopes. |
| `emailClaim` | string | `email` | |
| `nameClaim` | string | `name` | |
| `cookieName` | string | `portal_session` | Session cookie name. |
| `sessionTtlHours` | integer, 1 to 8760 | `168` | Session lifetime in hours. |

At boot, `oidc` mode also requires, and reports together if missing: `PORTAL_OIDC_CLIENT_SECRET` set, `PORTAL_SESSION_SECRET` set and at least 32 characters, an `issuer` for non-Google providers, and at least one entry in `allowedDomains` or `allowedEmails`. The client secret and session key are never read from `portal.yaml`.

## skills

Optional block with no default. When absent, the portal has no curated marketplaces, and the admin Marketplace tab offers only the index bundled with the app. The subsystem is inactive unless the `SKILLS_ENABLED` flag is on (see [feature-flags.md](./feature-flags.md)).

| Key | Type | Default | Controls |
| --- | --- | --- | --- |
| `marketplaces` | list of URLs | `[]` | Index URLs, each a JSON document listing installable skills. Only `http` and `https` are accepted, enforced at boot. |
| `builtinMarketplace` | boolean | `true` | Whether the index bundled with the app is offered alongside the configured ones. Set `false` to offer only your own. |

```yaml
skills:
  marketplaces:
    - https://skills.example.com/index.json
  builtinMarketplace: true
```

## Minimal example

```yaml
app:
  name: "Your Org Workspace"
  kbDescription: "the Your Org knowledge base"
  feedbackUrl: "mailto:feedback@example.com"

repo:
  vaultSubdir: docs

auth:
  mode: jwt
  jwt:
    algorithm: HS256
    secret: ${PORTAL_JWT_SECRET}
    issuer: https://idp.example.com
    audience: your-org-portal
```
