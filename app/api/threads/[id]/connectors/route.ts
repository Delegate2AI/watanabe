import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { listThreadConnectors, setThreadConnector } from "@/lib/db/thread-connectors";
import { dropWarmSessionSoon } from "@/lib/agent/session";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { loadConnectorRegistry } from "@/lib/connectors/registry";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  slug: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * Owner-gated route pair for per-thread connector opt-in (spec 33). Both
 * verbs are strict-ownership (`isOwnedBy`): a foreign id and an unknown id
 * both 404, keeping the no-oracle property, and "unowned" counts as foreign
 * (the model-choice precedent). Flag off, the pair is a dark 404 surface.
 */

/** GET /api/threads/[id]/connectors -> the thread's enabled connector slugs. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("connectors request rejected", {
      route: "GET /api/threads/[id]/connectors",
      status: 401,
      reason: "unauthorized",
    });
    return auth.response;
  }
  const { identity } = auth;
  const { id } = await params;

  if (!isConnectorsEnabled()) return fail("not_found");

  try {
    if (!isOwnedBy(getDb(), id, identity.email)) {
      log.warn("connectors request rejected", {
        route: "GET /api/threads/[id]/connectors",
        status: 404,
        reason: "not found or not owned",
        owner: identity.email,
        threadId: id,
      });
      return fail("not_found");
    }
    return Response.json({ enabled: listThreadConnectors(getDb(), id) });
  } catch (e) {
    log.error("connectors request failed", {
      route: "GET /api/threads/[id]/connectors",
      status: 500,
      owner: identity.email,
      threadId: id,
      err: String(e),
    });
    return fail("internal");
  }
}

/**
 * PUT /api/threads/[id]/connectors -> toggle one connector for this thread.
 *
 * The slug must name a registry entry the CALLER is cleared for: an unknown
 * slug and a known-but-uncleared slug both come back as the same
 * `invalid_request`, so the toggle never becomes an oracle for connectors the
 * caller cannot see. On an actual state change the warm session is dropped so
 * the NEXT turn rebuilds with fresh grants (sessions resolve grants at
 * construction); a no-op toggle evicts nothing, mirroring the model-choice
 * route.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("connectors request rejected", {
      route: "PUT /api/threads/[id]/connectors",
      status: 401,
      reason: "unauthorized",
    });
    return auth.response;
  }
  const { identity } = auth;
  const { id } = await params;

  if (!isConnectorsEnabled()) return fail("not_found");

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    // Ownership before slug validation: a caller probing someone else's
    // thread learns nothing about which slugs exist or are cleared.
    if (!isOwnedBy(getDb(), id, identity.email)) {
      log.warn("connectors request rejected", {
        route: "PUT /api/threads/[id]/connectors",
        status: 404,
        reason: "not found or not owned",
        owner: identity.email,
        threadId: id,
      });
      return fail("not_found");
    }

    const clearance = new Set(resolveClearanceForEmail(identity.email));
    const cleared = loadConnectorRegistry().entries.some(
      (entry) => entry.slug === parsed.slug && entry.groups.some((group) => clearance.has(group)),
    );
    if (!cleared) {
      log.warn("connectors request rejected", {
        route: "PUT /api/threads/[id]/connectors",
        status: 400,
        reason: "unknown or uncleared slug",
        owner: identity.email,
        threadId: id,
      });
      return fail("invalid_request", { detail: "slug" });
    }

    const changed = setThreadConnector(getDb(), id, parsed.slug, parsed.enabled);
    // Sessions resolve connector grants at construction, so a real change must
    // evict the warm session for the next turn to see it. `dropWarmSessionSoon`
    // rather than `dropWarmSession`: a session that is BUSY streaming an answer
    // would otherwise refuse the eviction and silently keep the old grants, so
    // disabling a connector mid-turn would never take effect at all.
    if (changed) dropWarmSessionSoon(id);
    return Response.json({ enabled: listThreadConnectors(getDb(), id) });
  } catch (e) {
    log.error("connectors request failed", {
      route: "PUT /api/threads/[id]/connectors",
      status: 500,
      owner: identity.email,
      threadId: id,
      err: String(e),
    });
    return fail("internal");
  }
}
