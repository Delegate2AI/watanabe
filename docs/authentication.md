# Authentication

This document explains how Watanabe decides who is making a request. It covers the four `auth.mode` values (`proxy-header`, `jwt`, `oidc`, `none`), the local development fallbacks, how API tokens and OAuth authenticate MCP clients, and what to configure when the portal sits behind a reverse proxy. For what an identity is then allowed to do, see [access control](./access-control.md).

## How identity resolution works

Every route and page asks one function, `getIdentity`, who is calling (`../lib/auth/identity.ts`). It runs the strategy named by `auth.mode` in `portal.yaml`, and returns an email address and an optional display name. Precedence is:

1. The configured strategy.
2. The `X-Dev-Identity-Email` request header, only when `PORTAL_ALLOW_DEV_IDENTITY_HEADER=1`.
3. The `DEV_IDENTITY_EMAIL` environment variable.
4. No identity.

A request with no identity gets a `401` from API routes. For pages, the app shell redirects to `/login` in `oidc` mode and answers `404` in every other mode, because in those modes something upstream was supposed to establish identity.

The identity is only an email and a name. Groups, roles and clearance are looked up from the email afterwards (see [access control](./access-control.md)). The portal also records the name your identity provider sends into its people directory the first time it sees someone.

The `auth` block is validated strictly at boot. Only the sub-block named by `mode` may be present: any other auth sub-block in `portal.yaml` is rejected with an "Unrecognized key" error. When you switch modes, replace the sub-block as well as the `mode` value.

| Mode | Who proves identity | Use when |
|---|---|---|
| `proxy-header` (default) | An SSO proxy in front of the portal, which sets headers | You already run oauth2-proxy or similar and the portal is reachable only through it |
| `jwt` | The caller, with a signed token in a cookie or bearer header | Another system mints tokens (an IdP or your own gateway) and you want the portal to verify them |
| `oidc` | The portal itself, through an OpenID Connect login | You want the portal to run sign-in with Google or another OIDC provider and need no proxy |
| `none` | Nobody | Local evaluation on one machine |

## Mode: proxy-header

Use this when an authenticating reverse proxy (for example oauth2-proxy) sits in front of the portal and forwards the signed-in user's email in a header. The portal never talks to an identity provider in this mode. It only reads headers.

### Request flow

1. The proxy authenticates the user and forwards the request with an email header (default `X-Auth-Request-Email`) and optionally a name header (default `X-Auth-Request-User`).
2. The proxy, or the ingress, also adds an assertion header (default `X-Portal-Proxy-Assert`) whose value is a shared secret.
3. The portal reads the email header. If it is missing, there is no identity.
4. If a secret is configured, the portal compares the assertion header to it in constant time. A missing or wrong value rejects the request as unauthenticated and logs a warning that never contains the secret.
5. If no secret is configured, the portal trusts the email header unverified and logs a warning once per process.

The assertion secret exists so that a client who can reach the portal without going through the proxy (for example another pod in the same cluster) cannot forge the email header. Header presence alone is not proof the request came through the proxy.

### Configuration

| Key | Default | Notes |
|---|---|---|
| `auth.mode` | `proxy-header` | Also the mode used when `portal.yaml` has no `auth` block |
| `auth.proxyHeader.emailHeader` | `X-Auth-Request-Email` | Header carrying the email |
| `auth.proxyHeader.userHeader` | `X-Auth-Request-User` | Header carrying the display name |
| `auth.proxyHeader.assertHeader` | `X-Portal-Proxy-Assert` | Header carrying the shared secret |
| `auth.proxyHeader.assertSecret` | unset | Shared secret. Unset means headers are trusted unverified |

The environment variable `PORTAL_PROXY_ASSERT_SECRET` takes precedence over `assertSecret` in `portal.yaml`. It is read on each request. Set the secret through the environment rather than committing it.

```yaml
auth:
  mode: proxy-header
  proxyHeader:
    emailHeader: X-Auth-Request-Email
    userHeader: X-Auth-Request-User
    assertHeader: X-Portal-Proxy-Assert
    assertSecret: ${PORTAL_PROXY_ASSERT_SECRET}
```

```bash
PORTAL_PROXY_ASSERT_SECRET="$(openssl rand -base64 32)"
```

Sign-out in this mode is the proxy's job. The account menu links to the URL in `NEXT_PUBLIC_SIGN_OUT_URL`, or `/oauth2/sign_out` when that is unset (`../components/shell/settings-menu.tsx`). `NEXT_PUBLIC_` variables are inlined into the client bundle, so set this before you build the image.

## Mode: jwt

Use this when something else mints signed tokens and you want the portal to verify them on every request. The portal does not issue tokens and does not redirect to a login page in this mode.

### Request flow

1. The portal reads a token from a cookie (`source: cookie`, the default) or from an `Authorization: Bearer <token>` header (`source: bearer`).
2. It verifies the signature, expiry, not-before time, issuer and audience. The algorithm is pinned to the configured one, so a token cannot choose its own algorithm.
3. It reads the email from the configured claim, and the name from another claim. A token with no usable email claim is rejected.
4. Any failure resolves to "no identity". API routes then answer `401`, and app pages answer `404` (see the resolution order above).

For `RS256` the portal fetches and caches the key set from `jwksUrl`. For `HS256` it uses a shared secret.

### Configuration

| Key | Default | Notes |
|---|---|---|
| `auth.jwt.algorithm` | required | `RS256` or `HS256` |
| `auth.jwt.jwksUrl` | none | Required for `RS256`, forbidden for `HS256` |
| `auth.jwt.secret` | none | Required for `HS256`, forbidden for `RS256` |
| `auth.jwt.issuer` | required | Must match the token's `iss` |
| `auth.jwt.audience` | required | Must match the token's `aud` |
| `auth.jwt.source` | `cookie` | `cookie` or `bearer` |
| `auth.jwt.cookieName` | `portal_session` | Used when `source` is `cookie` |
| `auth.jwt.emailClaim` | `email` | Claim holding the email |
| `auth.jwt.nameClaim` | `name` | Claim holding the display name |

RS256 example:

```yaml
auth:
  mode: jwt
  jwt:
    algorithm: RS256
    jwksUrl: https://idp.example.com/.well-known/jwks.json
    issuer: https://idp.example.com
    audience: watanabe
    source: bearer
```

HS256 example:

```yaml
auth:
  mode: jwt
  jwt:
    algorithm: HS256
    secret: ${PORTAL_JWT_SECRET}
    issuer: https://idp.example.com
    audience: watanabe
    source: cookie
    cookieName: portal_session
```

`${PORTAL_JWT_SECRET}` is interpolated from the environment when the config loads. The schema rejects a `secret` next to `RS256`, and a `jwksUrl` next to `HS256`, so a setting that would never be read cannot sit in the file looking configured.

## Mode: oidc

In this mode the portal runs the sign-in itself with the OpenID Connect Authorization Code flow and PKCE. After a successful sign-in it issues its own signed session cookie, and every later request is authenticated from that cookie. No proxy is needed. The full guide, including provider setup, admission rules, cookie naming and error messages, is in [OIDC login auth mode](./oidc-auth-mode.md).

In short:

- `GET /api/auth/login` starts a sign-in and redirects to the provider. `GET /api/auth/callback` completes it. `POST /api/auth/logout` clears the session cookie. All three answer `404` in any other mode.
- Unauthenticated page loads redirect to `/login`.
- The session is a stateless signed cookie (HS256, default lifetime 168 hours). There is no server-side session to revoke. Rotating `PORTAL_SESSION_SECRET` invalidates every session at once.
- The portal refuses to start unless the client secret and a session secret of at least 32 characters are set, a non-Google provider has an `issuer`, and at least one of `allowedDomains` or `allowedEmails` is non-empty.

Minimal configuration:

```yaml
auth:
  mode: oidc
  oidc:
    provider: google
    clientId: your-client-id
    baseUrl: https://portal.example.com
    allowedDomains:
      - example.com
```

```bash
PORTAL_OIDC_CLIENT_SECRET=...
PORTAL_SESSION_SECRET="$(openssl rand -base64 48)"
```

`baseUrl` is the public origin of the portal. It must be `https` except on a loopback host, and the redirect URI you register with the provider is derived from it, never from a request header.

## Mode: none

`none` disables authentication. Every request is treated as one fixed identity. Use it only to evaluate Watanabe on your own machine.

Two things are required, and both must be present:

1. `auth.mode: none` with an `auth.none.email` in `portal.yaml`.
2. `PORTAL_ALLOW_NO_AUTH=1` in the process environment.

If the mode is `none` and the variable is not `1`, the process refuses to start (`../lib/config/load.ts`). This is deliberate: a `portal.yaml` that leaks into a real deployment cannot switch authentication off on its own.

```yaml
auth:
  mode: none
  none:
    email: you@example.com
    name: Local Evaluator
```

```bash
PORTAL_ALLOW_NO_AUTH=1
BOOTSTRAP_ADMINS=you@example.com
```

`BOOTSTRAP_ADMINS` makes that address an administrator, so you can reach the admin screens (see [access control](./access-control.md)). The bundled `docker-compose.yml` and `docker/portal.local.yaml` use exactly this setup and publish the port on `127.0.0.1` only.

Do not expose a `none` instance to a network. Anyone who can reach it acts as the configured identity, and if `KB_WRITE_ENABLED=1` they can propose changes to the knowledge base as that identity.

## Local development fallbacks

These two work in every mode, and exist so you can run the portal without a login.

| Mechanism | How it works | Guard |
|---|---|---|
| `DEV_IDENTITY_EMAIL` | Server-wide: when the active strategy yields no identity, every request runs as this address | None beyond being set in the server environment. It is not controllable by a client, but it is also not tied to `NODE_ENV`, so do not set it in production |
| `X-Dev-Identity-Email` header | Per request: lets two `curl` calls against one dev server act as two users | Honored only when `PORTAL_ALLOW_DEV_IDENTITY_HEADER=1`. It is never inferred from `NODE_ENV` |

Both are consulted only after the configured strategy returned nothing. In production leave both unset.

```bash
DEV_IDENTITY_EMAIL=dev@example.com pnpm dev

PORTAL_ALLOW_DEV_IDENTITY_HEADER=1 pnpm dev
curl -H 'X-Dev-Identity-Email: alice@example.com' http://localhost:3100/api/capabilities
```

## Authenticating MCP clients

The MCP endpoint `/api/mcp` accepts two kinds of credential (`../app/api/mcp/auth.ts`). Setup of the clients themselves is covered in [integrations](./integrations.md).

1. A bearer token in the `Authorization: Bearer <token>` header.
2. The normal portal identity for the configured `auth.mode`, such as a session cookie.

The endpoint is served only when `MCP_ENABLED=1`. With the flag off every request is refused identically.

Bearer tokens come in two forms, and both live in the same database table:

- **Portal tokens.** An administrator mints one from `POST /api/admin/mcp-tokens` (requires the `manageAccess` capability, which is the admin role). The plaintext is returned once. Only its SHA-256 hash is stored.
- **OAuth tokens.** The portal can act as an OAuth authorization server so an MCP client can register itself and obtain a token after a person approves it. This requires `MCP_PUBLIC_ORIGIN` to be set to the portal's public `https` origin (loopback `http` is also accepted). From that origin the portal derives these endpoints:

| Endpoint | Path |
|---|---|
| Authorization (consent page) | `/oauth/authorize` |
| Token | `/api/oauth/token` |
| Dynamic client registration | `/api/oauth/register` |
| Resource | `/api/mcp` |

The portal also serves discovery documents under `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/mcp`. It supports the `authorization_code` and `refresh_token` grants, `S256` PKCE only, public clients only (no client secret), and a single scope, `mcp`. Redirect URIs are matched by exact string equality against those registered. The consent step requires the person to be signed in through the portal's normal authentication, and it checks the request `Origin` against `MCP_PUBLIC_ORIGIN`.

Rules that apply to every bearer token:

- A token is accepted only if its owner is a known member, meaning the owner appears in some group in the access files. Removing someone from every group therefore stops every token they hold.
- A token carries only its owner. Roles and clearance are resolved on each call, so changing a role takes effect without reissuing the token.
- Revoked, expired, unknown and non-member tokens all produce the same refusal.
- A person can list and revoke their own tokens at `/api/settings/mcp-tokens`. Revocation is limited to the owner.

## Running behind a reverse proxy that sets identity headers

This applies to `proxy-header` mode. What the code confirms:

- The portal trusts whatever value arrives in the email header (default `X-Auth-Request-Email`) and name header (default `X-Auth-Request-User`) once the assertion check passes. It does not itself know whether a client or the proxy set them.
- The assertion check is the mechanism the code provides for telling the two apart. Configure the proxy or ingress to add the assertion header with the shared secret, and set the same value in `PORTAL_PROXY_ASSERT_SECRET` on the portal. A request without the correct assertion value is treated as unauthenticated.
- Without a configured secret the portal logs a warning once and trusts the headers from anyone who can reach it. In that posture the proxy must be the only network path to the portal.
- Header names are looked up case-insensitively, and you can rename all three with the `auth.proxyHeader.*Header` keys to match your proxy.
- The `/api/mcp` route is documented in the code as the one path the SSO proxy does not gate, because MCP clients authenticate with their own bearer tokens. If your proxy enforces sign-in for every path, exempt `/api/mcp`, `/api/oauth/*` and the `/.well-known/` documents listed above, or MCP clients cannot connect. The OAuth `token` and `register` endpoints are called by clients that have no browser session.

The repository does not contain proxy configuration for stripping headers from client requests, so this document does not prescribe it. Make sure your own proxy configuration overwrites or removes any client-supplied copies of the three headers above, and use the assertion secret as the control the portal itself enforces.

## Related

- [OIDC login auth mode](./oidc-auth-mode.md)
- [Access control](./access-control.md)
- [Integrations](./integrations.md)
- [portal.example.yaml](../portal.example.yaml) and [.env.example](../.env.example)
