import { z } from "zod";
import { evictAllWarmSessions, evictSessionsForOwner } from "@/lib/agent/session-evict-all";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { loadConnectorRegistry } from "@/lib/connectors/registry";
import { connectorEnvVars, withoutOauthClientSecret, writeConnectors, type ConnectorChange } from "@/lib/connectors/store";
import { EntrySchema, RESERVED_CONNECTOR_SLUGS, SLUG_RE } from "@/lib/connectors/types";
import { getDb } from "@/lib/db/client";
import { deleteCredentialsForSlug, listCredentialOwners } from "@/lib/db/connector-credentials";
import { fail } from "@/lib/errors/codes";
import { scrubReason } from "@/lib/errors/scrub-reason";
import { readCappedBody } from "@/lib/http/capped-body";
import { log } from "@/lib/log";

/**
 * Ceiling on a JSON change body here, the same shape and reasoning as
 * `MAX_SKILL_ACTION_BODY_BYTES`: every change this route accepts is a handful of
 * short strings plus bounded group and tool lists, so the cap is a refusal, not
 * a budget.
 */
const MAX_CONNECTOR_CHANGE_BODY_BYTES = 64_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The admin half of spec 33: list the registry with its parse status and the
 * presence of every `${VAR}` it references, and apply one curated change.
 *
 * Admin-gated with `manageAccess`, exactly like `/api/access`, and dark behind
 * `CONNECTORS_ENABLED`. The flag is checked before the capability so that
 * flag-off answers the same 404 for an admin and a viewer alike.
 */
const newSlug = z
  .string()
  .regex(SLUG_RE)
  .refine((slug) => !RESERVED_CONNECTOR_SLUGS.has(slug), { message: "reserved slug" });

/**
 * A removal names a key that is ALREADY in the file, so it deliberately does
 * not go through `newSlug`. Constraining a delete the way an add is constrained
 * would leave a hand-seeded `kb:` or `Legacy-Thing:` entry visible as a
 * disabled row and impossible to clear from the surface that surfaced it. The
 * real gate is the store's `Object.hasOwn` check, which answers `not_found` for
 * anything the file does not carry; the length cap only bounds the body.
 */
const existingSlug = z.string().min(1).max(200);

const changeSchema = z.discriminatedUnion("verb", [
  z.object({ verb: z.literal("upsert"), slug: newSlug, entry: EntrySchema }).strict(),
  z.object({ verb: z.literal("remove"), slug: existingSlug }).strict(),
]);

/**
 * `writeConnectors` reports why it refused in its own vocabulary. Translate to
 * a code rather than forwarding the sentence: anything not listed here is a
 * failed commit whose text is a git message, which has no business in a body.
 */
const BAD_CHANGE = new Set([
  "invalid slug",
  "reserved slug",
  "invalid connector entry",
  "invalid connector groups",
  "connector configuration failed validation",
]);

function refusal(reason: string): Response {
  if (reason === "forbidden") return fail("needs_role");
  if (reason === "unknown connector") return fail("not_found");
  if (BAD_CHANGE.has(reason)) return fail("invalid_request", { detail: "change" });
  return fail("internal");
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isConnectorsEnabled()) return fail("not_found");
  if (!can(auth.identity.email, "manageAccess")) return fail("needs_role");

  const registry = loadConnectorRegistry();
  const entries = [
    ...registry.entries.map((entry) => ({
      ...withoutOauthClientSecret(entry),
      status: "ok" as const,
      envVars: connectorEnvVars(entry),
    })),
    ...registry.errors.map((error) => ({
      slug: error.slug,
      status: "disabled" as const,
      // Scrubbed, never forwarded verbatim: a loader reason can be a YAML or
      // filesystem error carrying an absolute server path.
      reason: scrubReason(error.reason),
      envVars: [],
    })),
  ].sort((a, b) => a.slug.localeCompare(b.slug));
  return Response.json({ entries });
}

function evictOwnersOrAll(slug: string): void {
  try {
    for (const owner of listCredentialOwners(getDb(), slug)) {
      evictSessionsForOwner(owner);
    }
  } catch (e) {
    log.warn("connector credential eviction lookup failed, evicting all warm sessions", { slug, err: String(e) });
    evictAllWarmSessions();
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isConnectorsEnabled()) return fail("not_found");
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return fail("needs_role");

  const read = await readCappedBody(request, MAX_CONNECTOR_CHANGE_BODY_BYTES);
  if (!read.ok) {
    // A body that never arrived whole is the request's problem, not the
    // server's, and a dropped connection mid-post is an ordinary event. It gets
    // the same answer unparseable JSON always got.
    if (read.reason === "unreadable") return fail("invalid_request", { detail: "body" });
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  const previousEntry =
    parsed.data.verb === "upsert"
      ? loadConnectorRegistry().entries.find((candidate) => candidate.slug === parsed.data.slug)
      : undefined;

  const result = await writeConnectors(parsed.data as ConnectorChange, actorEmail);
  if (!result.ok) return refusal(result.error);

  if (parsed.data.verb === "remove") {
    evictOwnersOrAll(parsed.data.slug);
    try {
      deleteCredentialsForSlug(getDb(), parsed.data.slug);
    } catch (e) {
      log.warn("connector credential purge failed", { slug: parsed.data.slug, err: String(e) });
    }
  } else if (previousEntry && previousEntry.auth !== parsed.data.entry.auth) {
    evictAllWarmSessions();
  } else {
    evictOwnersOrAll(parsed.data.slug);
  }

  return Response.json({ ok: true });
}
