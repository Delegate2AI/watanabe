import { randomUUID } from "node:crypto";
import { requireIdentity } from "@/lib/auth/identity";
import { isAttachmentsEnabled } from "@/lib/attachments/store";
import { getDb } from "@/lib/db/client";
import { threadSummaries } from "@/lib/threads/summaries";
import { recordThread } from "@/lib/db/threads";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/threads → the CALLER's threads for the sidebar (Recents + Pinned).
 *
 * Identity-scoped: `listThreadsForOwner` filters to the requester's own email,
 * so one user's list can never surface another's threads. Each thread carries
 * its `pinned` flag; the sidebar groups on it. This is the spec-24 replacement
 * for the spec-18 stub thread data.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("threads request rejected", { route: "GET /api/threads", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;
  try {
    return Response.json({ threads: threadSummaries(getDb(), identity.email) });
  } catch (e) {
    log.error("threads request failed", {
      route: "GET /api/threads",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("threads request rejected", { route: "POST /api/threads", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  if (!isAttachmentsEnabled()) return fail("not_found");

  const id = randomUUID();
  try {
    recordThread(getDb(), id, identity.email, undefined);
    log.info("thread pre-minted", { route: "POST /api/threads", owner: identity.email, threadId: id });
    return Response.json({ id });
  } catch (e) {
    log.error("threads request failed", {
      route: "POST /api/threads",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
