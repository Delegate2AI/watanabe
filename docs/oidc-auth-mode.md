# OIDC login auth mode

This page is for an operator setting up `auth.mode: oidc`, the portal's
self-hosted login mode. It assumes no prior familiarity with this codebase.

## What this mode is, and when to choose it

The portal has four auth modes, set by `auth.mode` in `portal.yaml`:
`proxy-header`, `jwt`, `none`, and `oidc`. The first three all assume
something else already performed the login: `proxy-header` reads identity
headers an SSO proxy in front of the app (an oauth2-proxy, for example) has
already validated, `jwt` verifies a token some other issuer minted, and `none`
hands back a fixed identity for local development.

`oidc` is different: the portal performs the login itself. It runs a
complete OAuth 2.0 Authorization Code flow with PKCE against your identity
provider, driven by OIDC discovery, so the same code path works against
Google, Logto, Okta, Keycloak, Auth0, or any other standards-compliant OIDC
provider. After a successful sign-in the portal mints its own signed session
cookie and reads identity back from that cookie on every request. There is no
user table and no session table; the cookie is the whole of it.

Choose `proxy-header` if you already run an SSO gateway in front of this app
(an ingress with oauth2-proxy, for instance) that injects trusted identity
headers. Choose `oidc` if you are self-hosting with no such gateway and want
the portal to own the login itself. `auth.mode` defaults to `proxy-header`,
so nothing about this mode is reachable unless you write `mode: oidc`
yourself.

## The `portal.yaml` block

Every field below lives under `auth.oidc`. Fields with no default are
required.

```yaml
auth:
  mode: oidc
  oidc:
    provider: google               # google | logto | generic. Default: google
    issuer:                        # required for every provider except google
    clientId: "your-client-id"     # required, no default
    baseUrl: https://portal.example.com   # required, no default
    allowedDomains: []              # default: empty
    allowedEmails: []               # default: empty
    scopes: [openid, email, profile]      # default
    emailClaim: email               # default
    nameClaim: name                 # default
    cookieName: portal_session      # default
    sessionTtlHours: 168            # default, 7 days, capped at 8760 (one year)
```

Field notes:

- `provider`: `google` fixes the issuer to `https://accounts.google.com` and
  turns on the Workspace-domain admission rule described below. `logto` and
  `generic` have no fixed issuer, so `issuer` is required for both.
  `provider: google` may NOT also carry an `issuer`: Google's issuer is fixed,
  and boot fails if one is set alongside it. This is not a formality; the
  Workspace-domain (`hd`) admission rule is only trusted when the effective
  issuer is exactly Google's, so a `provider: google` config pointed at a
  different issuer would otherwise keep `hd` trust while talking to a
  provider that never earned it.
- `issuer`: the identity provider's issuer URL, required for every provider
  except `google`. Must be `https`, with one exception: a loopback host
  (`localhost`, `127.0.0.1`, or `::1`) may use `http`, so a local identity
  provider still works during development. Any other `http` issuer fails at
  boot: an `http` issuer means an on-path attacker could serve a forged JWKS
  or read the client secret this portal posts to the token endpoint in
  plaintext.
- `clientId`: the OAuth client ID your provider issued for this portal.
- `baseUrl`: the absolute origin this portal is reachable at, for example
  `https://portal.example.com`. The redirect URI you register with your
  provider is derived from this value, never from a request header, so a
  request cannot redirect the authorization code somewhere else by forging a
  `Host` header. It must be an origin with no path: the app has no
  `basePath`, and every URL derived from it (the redirect URI, the sign-in
  link, the return path after login) would be wrong if `baseUrl` carried one.
  Like `issuer`, `baseUrl` must be `https` except on a loopback host: boot
  fails on `http://portal.example.com` but accepts `http://localhost:3100`.
  An `http` `baseUrl` also drops the `Secure` flag on every cookie this mode
  sets, which is exactly why a real deployment cannot use one.
- `allowedDomains`: a list of email domains allowed to sign in.
- `allowedEmails`: a list of individual email addresses allowed to sign in,
  regardless of domain.
- At least one of `allowedDomains` or `allowedEmails` must be non-empty. A
  config with both empty fails at boot: a portal that admits anyone with a
  Google account is never what someone meant to configure.
- `emailClaim`: which claim in the ID token carries the signed-in email
  address. Left at its default (`email`), this needs no further explanation:
  the provider's `email_verified` claim is an assertion about exactly that
  claim. Set to anything else (`upn`, `preferred_username`, and the like,
  common on Okta, Keycloak, and Azure AD-backed providers), that claim is
  trusted as identity ONLY when its value matches the token's own standard
  `email` claim, case-insensitively. A token where they disagree, or that
  carries a custom claim but no standard `email` claim at all, is rejected.
  This exists because those custom claims are often user-editable profile
  fields: `email_verified` never attested to them, only to `email`, so a
  custom claim can only ever be an alias for that same, already-verified
  address, never an independent identity.
- `scopes`, `nameClaim`, `cookieName`, `sessionTtlHours` all have working
  defaults and rarely need changing.

## The two environment variables

Two secrets are read from the environment, never from `portal.yaml`, because
the config file is committed to git in a real deployment.

| Variable | Purpose |
|---|---|
| `PORTAL_OIDC_CLIENT_SECRET` | The OAuth client secret your provider issued alongside the client ID |
| `PORTAL_SESSION_SECRET` | The signing key for the portal's own session cookie, at least 32 characters |

Boot fails with a descriptive error, naming every missing piece, if either
variable is unset, if `PORTAL_SESSION_SECRET` is shorter than 32 characters,
if a non-google provider has no `issuer`, if `provider: google` carries an
`issuer` anyway, if `issuer` or `baseUrl` is `http` on anything other than a
loopback host, or if both `allowedDomains` and `allowedEmails` are empty.

Generate a session secret with:

```bash
openssl rand -base64 48
```

Treat it like any other credential: generate one per deployment, and never
commit it to `portal.yaml` or anywhere else in the repository.

## The redirect URI to register with your provider

Every OIDC provider needs to know where to send someone back after they sign
in. That address is always:

```
<baseUrl>/api/auth/callback
```

For example, if `baseUrl` is `https://portal.example.com`, register
`https://portal.example.com/api/auth/callback` as the redirect URI (also
sometimes called the authorized redirect URI, or the callback URL) with your
provider.

## Cookie names and the `__Host-` prefix

This mode sets five cookies: the session cookie (named by `cookieName`) and
four short-lived ones used only during sign-in (state, nonce, PKCE verifier,
and the return path). On any deployment where `baseUrl` is `https`, the
portal prefixes every one of them with `__Host-` before sending it to the
browser: `cookieName: portal_session` shows up in the browser as
`__Host-portal_session`, for example.

This is not cosmetic. This portal is commonly deployed under a shared parent
domain alongside other applications. Without the prefix, a hostile sibling
subdomain could set its own cookie with the exact same name and ride along
with every request to this portal (cookie tossing), which for the sign-in
cookies would let it plant a state, nonce, or PKCE verifier of its choosing
ahead of time. `__Host-` closes this: a browser only accepts a
`__Host-`-prefixed `Set-Cookie` when it also carries `Secure`, `Path=/`, and
no `Domain` attribute, which makes the cookie host-only, so nothing on a
sibling subdomain can set or override it.

Nothing to configure here. The prefix is applied automatically whenever
`baseUrl` is `https`, and left off automatically on a loopback `http` deploy
(`http://localhost:3100` and the like), because a browser refuses a
`__Host-` cookie with no `Secure` flag and local development runs without
TLS. If you inspect cookies in your browser's devtools while testing a real
deployment, expect to see the `__Host-` prefix; its absence there would mean
`baseUrl` is not actually `https` as configured.

## Setting up a Google OAuth client

These are the steps for `provider: google`, the mode's built-in preset.

1. Open the Google Cloud console and select (or create) the project this
   portal should authenticate under.
2. If you have not configured one yet, set up the OAuth consent screen for
   that project first. Google requires this before it will let you create a
   client.
3. Go to **APIs & Services > Credentials** and choose **Create Credentials >
   OAuth client ID**.
4. For **Application type**, choose **Web application**.
5. Under **Authorized redirect URIs**, add the redirect URI from the section
   above: `<baseUrl>/api/auth/callback`.
6. Create the client, then copy the **Client ID** and **Client secret** it
   generates.
7. Set `auth.oidc.clientId` in `portal.yaml` to the client ID, and
   `PORTAL_OIDC_CLIENT_SECRET` in your deployment's environment to the client
   secret.

Leave `provider` at its default (`google`) and leave `issuer` unset; the
mode already knows Google's issuer, and setting one anyway fails at boot.

## Admission rules, in plain language

Once someone's identity token is verified, the portal decides whether to let
them in using these rules, checked in order:

1. **`allowedEmails` is an exact match.** If the signed-in email address
   appears in `allowedEmails` (case-insensitive), that person is admitted,
   full stop, regardless of what domain the address belongs to. This is the
   path for an individual contractor or a personal account that should be
   let in without opening the whole domain.
2. **For Google, Workspace membership decides everyone else.** Google
   asserts whether an account belongs to a Google Workspace domain as part
   of the identity token. If the account belongs to a Workspace domain, that
   domain must appear in `allowedDomains`. If the account is a personal
   Google account (no Workspace domain, for example an `@gmail.com`
   address), it is refused unless that exact address is separately listed in
   `allowedEmails`. There is no way to admit "all Gmail users" through
   `allowedDomains` for this reason: personal Google accounts only get in
   through `allowedEmails`.
3. **For other providers, the domain of the verified email decides.** Logto,
   Okta, Keycloak, and other providers that do not assert Workspace-style
   membership are checked against the domain portion of the verified email
   address, matched against `allowedDomains`.

Email comparisons are case-insensitive on both sides.

## What each sign-in error means

A failed sign-in redirects to `/login?error=<code>` with one of these codes.
Each maps to a short message on the sign-in page itself; here is what each
one actually indicates:

| Code | What happened |
|---|---|
| `missing_params` | The callback request was missing the authorization code, the state value, or one of the short-lived cookies the sign-in started with. Usually a stale or reused sign-in link. |
| `state_mismatch` | The `state` value returned by the provider did not match the one the portal set when the sign-in started. This is the login-CSRF check; a mismatch means the request did not originate from a sign-in this portal started. |
| `exchange_failed` | The portal reached the identity provider but the exchange itself did not succeed. This is every `exchangeCode` failure, including a rejected exchange (invalid code, invalid PKCE verifier) and a network failure or timeout talking to the token endpoint. |
| `token_invalid` | The identity token returned by the provider failed verification: a bad signature, wrong issuer or audience, an expired token, a mismatched nonce, an unverified email, or a missing email claim. |
| `not_allowed` | The token verified correctly, but the person is not on the admission list (see the rules above). This code is also used when the provider itself reported an error, for example someone who declined the consent screen. |
| `provider_unreachable` | The portal could not reach the identity provider to discover its endpoints, either when starting a sign-in or during the callback. Discovery is cached after its first success, so on the callback this code is only reachable on a deployment's first sign-in or right after the provider comes back from an outage. A failed token exchange is `exchange_failed`, not this code: discovery and the exchange are separate network calls, and each maps to its own reason. |

No sign-in failure ever exposes a token, an authorization code, a client
secret, or a stack trace to the browser: every failure redirects to `/login`
with nothing but its reason code in the query string. The server-side log
line for that failure carries the reason code plus diagnostic context, such
as the identity provider's issuer URL, an HTTP status, or a claim name, but
never a token, a code, or a secret value.

The one exception is the success path, which is not a failure and so is not
in the table above: a completed sign-in logs `oidc login succeeded` with the
signed-in email address attached. That is deliberate, an audit trail of who
signed in, but it means email addresses reach your log storage on every
sign-in. If your log retention or PII policy treats email addresses as
sensitive, account for that line specifically; nothing else this mode logs
carries one.

## Known limits

**No server-side session revoke.** The session cookie is a stateless signed
token: the portal issues it, verifies it on each request, and there is
nothing recorded on the server to revoke. Signing out only clears the
cookie in the browser that asked for it. To end every existing session at
once, for example after an offboarding or a suspected leaked secret, rotate
`PORTAL_SESSION_SECRET`. Every session signed with the old secret stops
verifying immediately, and everyone has to sign in again.

**Editing `allowedDomains` or `allowedEmails` does not evict anyone already
signed in.** Admission is checked once, at sign-in, when the identity token
is verified. On every later request the portal only re-verifies the session
cookie's signature and expiry; it does not re-run the admission check
against the current config. Someone removed from both lists keeps their
existing session until it expires (see `sessionTtlHours`) or until
`PORTAL_SESSION_SECRET` is rotated, whichever comes first. Treat a config
change as taking effect for new sign-ins immediately and for existing ones
only on one of those two events.

**No return path after an expired session.** When someone's session cookie
is missing or has expired, the app redirects them to `/login` with no
record of what page they were on, so after signing in again they land on
the app's home page rather than back where they were. This only affects
that automatic redirect; a sign-in link that itself carries a `next`
parameter (`/api/auth/login?next=/some/path`) still honors it and returns
the person to that path.

**Two sign-ins racing in the same browser will fail one of them.** Starting
a sign-in writes the state, nonce, and PKCE verifier to fixed cookie names.
Opening `/api/auth/login` in a second tab before the first one completes
overwrites those same cookies, so whichever callback lands second carries a
`state` value that no longer matches the (now overwritten) cookie, and fails
with `state_mismatch`, the login-CSRF check, before the exchange or the
token is even looked at. This is a same-browser, same-cookie-jar situation,
not a security issue: sign in from one tab at a time.
