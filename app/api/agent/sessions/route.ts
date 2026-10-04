import { getSession, sessionExistsOnDisk } from "@/lib/agent/session";
import { loadTranscript } from "@/lib/agent/transcript";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { listThreadsForOwner } from "@/lib/db/threads";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/agent/sessions          → list the CALLER's past chats (newest first)
 * GET /api/agent/sessions?id=<uuid> → rebuilt transcript (Turn[]) for one session
 *
 * The list comes from our own thread-ownership store (not the SDK's global
 * session store), filtered to the requester's own threads — it never
 * surfaces another user's chats, or unrelated Claude Code sessions for the
 * repo. The single-transcript lookup checks ownership first and 403s on a
 * mismatch (including an id this store has never seen at all — see
 * lib/db/ownership.ts's `isOwnedBy`).
 *
 * An OWNED id whose transcript reads empty is ambiguous: it can mean "first
 * turn still in flight, nothing flushed to the SDK's disk store yet" (alive)
 * or "the on-disk transcript is gone" (dead — e.g. the store was cleaned).
 * The client used to guess, and guessed wrong for in-flight turns, wiping a
 * healthy session's id from localStorage (spec 15 D32). Now the server
 * answers definitively: **404** only when the transcript is empty AND the
 * session is cold in memory AND `sessionExistsOnDisk` finds nothing;
 * otherwise 200 with the (possibly empty) turns. The 404 branch sits
 * strictly AFTER the ownership check, so unknown and foreign ids remain
 * indistinguishable (both 403) — no new existence oracle.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", { route: "GET /api/agent/sessions", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id) {
      if (!isOwnedBy(getDb(), id, identity.email)) {
        log.warn("agent request rejected", {
          route: "GET /api/agent/sessions",
          status: 403,
          reason: "ownership mismatch",
          owner: identity.email,
          sessionId: id,
        });
        return fail("not_cleared");
      }
      const turns = await loadTranscript(id);
      // `active` (spec 15 D34): whether a turn is in flight for this session
      // RIGHT NOW. Lets a client that hard-refreshed mid-turn keep polling
      // this same endpoint until the turn lands, instead of freezing on the
      // partial transcript it got back first.
      const active = getSession(id)?.isBusy ?? false;
      if (turns.length === 0 && !getSession(id) && !(await sessionExistsOnDisk(id))) {
        log.warn("agent request rejected", {
          route: "GET /api/agent/sessions",
          status: 404,
          reason: "session no longer exists",
          owner: identity.email,
          sessionId: id,
        });
        return fail("not_found");
      }
      return Response.json({ turns, active });
    }
    const threads = listThreadsForOwner(getDb(), identity.email);
    return Response.json({
      sessions: threads.map((t) => ({
        id: t.sdkSessionId,
        title: t.title ?? "New chat",
        updatedAt: t.updatedAt,
      })),
    });
  } catch (e) {
    log.error("agent request failed", {
      route: "GET /api/agent/sessions",
      status: 500,
      reason: "failed to read sessions",
      owner: identity.email,
      sessionId: id ?? undefined,
      err: String(e),
    });
    return fail("internal");
  }
}
