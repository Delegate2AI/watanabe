/**
 * Identity resolution for the portal: who is making this request.
 *
 * Since spec 16 this is a dispatcher. The actual work lives in one strategy per
 * `auth.mode` (see `portal.yaml`, `lib/config/schema.ts`):
 *
 *  - `proxy-header` (default): today's oauth2-proxy SSO headers, verified
 *    against a shared proxy-assertion secret. Unchanged behavior.
 *  - `jwt`: verify a signed token from a cookie or `Authorization: Bearer`.
 *  - `none`: one fixed identity for every request. Requires
 *    `PORTAL_ALLOW_NO_AUTH=1` at boot; see `lib/config/load.ts`.
 *  - `oidc`: the portal runs the login itself (Authorization Code + PKCE) and
 *    reads its own signed session cookie back. See the 2026-07-27 spec.
 *
 * ASYNC: `getIdentity` returns a promise because JWT verification is inherently
 * asynchronous (an RS256 JWKS has to be fetched). Every caller was already
 * inside an async function, so this costs an `await` and nothing else.
 *
 * Local-dev escape hatches, unchanged and available in every mode:
 *  - `DEV_IDENTITY_EMAIL` env var: a server-wide "run as this user" fallback.
 *    Requires server-level env access (not a client-controllable header), so it
 *    is not an impersonation risk and stays ungated.
 *  - `X-Dev-Identity-Email` request header: a PER-REQUEST override, so two
 *    `curl` calls against the SAME dev server can act as two different users.
 *    Fails CLOSED: honored ONLY when `PORTAL_ALLOW_DEV_IDENTITY_HEADER=1`. It
 *    is NOT keyed off `NODE_ENV`, because an unset/empty/misspelled `NODE_ENV`
 *    must never silently open a client-controllable impersonation bypass.
 *
 * Precedence: active strategy > dev header (if allowed) > `DEV_IDENTITY_EMAIL`
 * > no identity. A request that resolves to no identity is the caller's signal
 * to return a 401, never to proceed anonymously.
 */

import { getConfig } from "@/lib/config";
import type { PortalConfig } from "@/lib/config/schema";
import type { Identity, HeaderSource } from "./types";
import * as proxyHeader from "./strategies/proxy-header";
import * as jwt from "./strategies/jwt";
import * as none from "./strategies/none";
import * as oidc from "./strategies/oidc";

export type { Identity, HeaderSource } from "./types";
export { constantTimeEquals } from "./strategies/proxy-header";

const DEV_EMAIL_HEADER = "x-dev-identity-email";

/**
 * Whether the local-dev per-request identity override header is honored.
 * Opt-in ONLY, never inferred from `NODE_ENV`.
 */
function devHeaderAllowed(): boolean {
  return process.env.PORTAL_ALLOW_DEV_IDENTITY_HEADER === "1";
}

function clean(value: string | null | undefined): string | undefined {
  const t = value?.trim();
  return t && t.length > 0 ? t : undefined;
}

/** Run the configured strategy. Exported so tests can drive a mode directly. */
export async function resolveStrategy(
  headers: HeaderSource,
  auth: PortalConfig["auth"],
): Promise<Identity | null> {
  switch (auth.mode) {
    case "proxy-header":
      return proxyHeader.resolve(headers, auth.proxyHeader);
    case "jwt":
      return jwt.resolve(headers, auth.jwt);
    case "none":
      return none.resolve(auth.none);
    case "oidc":
      return oidc.resolve(headers, auth.oidc);
  }
}

/**
 * Resolve the calling identity. Returns `null` when the active strategy yields
 * nothing and neither dev fallback applies.
 */
export async function getIdentity(headers: HeaderSource): Promise<Identity | null> {
  const identity = await resolveStrategy(headers, getConfig().auth);
  if (identity) return identity;

  if (devHeaderAllowed()) {
    const devEmail = clean(headers.get(DEV_EMAIL_HEADER));
    if (devEmail) return { email: devEmail };
  }

  const envEmail = clean(process.env.DEV_IDENTITY_EMAIL);
  if (envEmail) return { email: envEmail };

  return null;
}

/** A clear, actionable 401: never a silent failure or a 500. */
export function unauthorized(): Response {
  return Response.json(
    {
      error:
        "no identity on this request — sign in via SSO, or for local dev set DEV_IDENTITY_EMAIL " +
        "(server-wide) or send an X-Dev-Identity-Email header (per-request, non-production only).",
    },
    { status: 401 },
  );
}

/**
 * Resolve identity or hand back the ready-to-return 401 `Response`:
 *
 *   const auth = await requireIdentity(request.headers);
 *   if ("response" in auth) return auth.response;
 *   const { identity } = auth;
 */
export async function requireIdentity(
  headers: HeaderSource,
): Promise<{ identity: Identity } | { response: Response }> {
  const identity = await getIdentity(headers);
  if (!identity) return { response: unauthorized() };
  return { identity };
}
