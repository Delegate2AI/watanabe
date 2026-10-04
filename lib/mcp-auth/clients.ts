import { randomUUID } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Dynamically registered OAuth clients (spec 2026-09-05, D4).
 *
 * Registration is open and issues **no client secret**. Every client is public
 * and PKCE is mandatory, which is what removes the credential there was nowhere
 * good to put. Registering grants nothing on its own: a client id buys the
 * ability to ask, and every authorization still needs a human to reach
 * /oauth/authorize through SSO and approve.
 *
 * What open registration does create is rows written by unauthenticated
 * callers, so everything here is bounded: the name, the number of redirect URIs
 * and their length. The route in front adds rate limiting.
 */

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

interface ClientRow {
  client_id: string;
  client_name: string;
  redirect_uris: string;
  created_at: string;
  last_used_at: string | null;
}

const MAX_NAME = 200;
const MAX_REDIRECTS = 10;
const MAX_REDIRECT_LENGTH = 2000;

/**
 * Whether a redirect URI may be registered.
 *
 * `https` everywhere, with http allowed only on loopback so local development
 * can connect. A fragment is refused because the authorization response appends
 * its own query and a fragment would be dropped or mangled by the redirect.
 *
 * There is no wildcard and no prefix form on purpose. Matching at authorization
 * time is exact string equality against this list, and a loose match here is
 * the defect that turns an open redirect into token theft.
 */
export function isRegisterableRedirectUri(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > MAX_REDIRECT_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  if (parsed.hash !== "") return false;
  // `new URL` happily parses "https://*.claude.ai/cb". Matching at
  // authorization is exact string equality, so such a URI could never match
  // anything and is harmless in itself, but registering it means the client
  // expects wildcard behaviour it will not get. Refuse it here, where the
  // refusal is legible, rather than at a redirect that silently never fires.
  if (!/^[a-z0-9.-]+$/i.test(parsed.hostname) && !/^\[[0-9a-f:]+\]$/i.test(parsed.hostname)) return false;
  if (parsed.protocol === "https:") return true;
  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  return parsed.protocol === "http:" && loopback;
}

function toClient(row: ClientRow): OAuthClient {
  return {
    clientId: row.client_id,
    clientName: row.client_name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Why this registration is refused, or null if it is fine.
 *
 * Pure and separate from the insert so the route never has to catch and forward
 * a message: an unexpected failure inside `registerClient` is a database
 * problem, and its text has no business reaching an anonymous caller. These
 * sentences are literals written for a developer wiring a client up, and they
 * name a rule rather than anything about this deployment.
 */
export function clientRegistrationProblem(input: { clientName: string; redirectUris: string[] }): string | null {
  const clientName = input.clientName.trim();
  if (clientName.length === 0 || clientName.length > MAX_NAME) {
    return "client_name must be between 1 and 200 characters";
  }
  if (input.redirectUris.length === 0 || input.redirectUris.length > MAX_REDIRECTS) {
    return `redirect_uris must name between 1 and ${MAX_REDIRECTS} URIs`;
  }
  if (!input.redirectUris.every(isRegisterableRedirectUri)) {
    return "every redirect_uri must be an absolute https URI, or http on loopback, with no fragment";
  }
  return null;
}

/**
 * Throws on invalid input, which the route avoids by asking
 * `clientRegistrationProblem` first. The throw stays as a backstop so no other
 * caller can write an unvalidated row.
 */
export function registerClient(
  db: DatabaseType,
  input: { clientName: string; redirectUris: string[] },
  now: string = new Date().toISOString(),
): OAuthClient {
  const clientName = input.clientName.trim();
  if (clientName.length === 0 || clientName.length > MAX_NAME) {
    throw new Error("client_name must be between 1 and 200 characters");
  }
  if (input.redirectUris.length === 0 || input.redirectUris.length > MAX_REDIRECTS) {
    throw new Error(`redirect_uris must name between 1 and ${MAX_REDIRECTS} URIs`);
  }
  if (!input.redirectUris.every(isRegisterableRedirectUri)) {
    throw new Error("every redirect_uri must be an absolute https URI, or http on loopback, with no fragment");
  }

  const clientId = randomUUID();
  db.prepare(
    `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at)
     VALUES (@clientId, @clientName, @redirectUris, @now)`,
  ).run({ clientId, clientName, redirectUris: JSON.stringify(input.redirectUris), now });
  return { clientId, clientName, redirectUris: [...input.redirectUris], createdAt: now, lastUsedAt: null };
}

export function getClient(db: DatabaseType, clientId: string): OAuthClient | null {
  const row = db
    .prepare(
      `SELECT client_id, client_name, redirect_uris, created_at, last_used_at
       FROM oauth_clients WHERE client_id = @clientId`,
    )
    .get({ clientId }) as ClientRow | undefined;
  return row ? toClient(row) : null;
}

/** Stamp a client that actually completed an authorization, so a registration that never did is identifiable and prunable. */
export function touchClient(db: DatabaseType, clientId: string, now: string = new Date().toISOString()): void {
  db.prepare(`UPDATE oauth_clients SET last_used_at = @now WHERE client_id = @clientId`).run({ now, clientId });
}
