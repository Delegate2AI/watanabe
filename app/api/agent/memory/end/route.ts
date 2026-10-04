import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { markDreamed } from "@/lib/db/threads";
import { fail } from "@/lib/errors/codes";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { isMemoryEnabled } from "@/lib/memory/config";
import { runDream } from "@/lib/memory/dream";
import { readTranscriptText } from "@/lib/memory/transcript";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  sessionId: z.string().uuid(),
});

/**
 * Explicit "end and save": the contributor asks to consolidate the thread's
 * memory right now, synchronously, so the UI can show what landed. This is a
 * belt-and-suspenders trigger alongside the idle/eviction/backstop dreams
 * (see `lib/memory/dream.ts`) that cover the case where nobody ever clicks.
 *
 * Ownership uses the same `isOwnedBy` posture as `POST /api/agent/permission`:
 * unowned counts as forbidden, not merely absent, since a transcript is
 * content-bearing.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", { route: "POST /api/agent/memory/end", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/memory/end",
      status: 400,
      reason: "invalid body",
      owner: identity.email,
      err: String(e),
    });
    return fail("invalid_request", { detail: "body" });
  }

  if (!isOwnedBy(getDb(), parsed.sessionId, identity.email)) {
    log.warn("agent request rejected", {
      route: "POST /api/agent/memory/end",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      sessionId: parsed.sessionId,
    });
    return fail("not_cleared");
  }

  if (!isMemoryEnabled()) return Response.json({ status: "skipped" });

  const transcript = await readTranscriptText(parsed.sessionId);
  const status = await runDream({
    sdkSessionId: parsed.sessionId,
    ownerEmail: identity.email,
    ownerName: identity.name,
    transcript,
    // Resolved here rather than trusted from the request: clearance decides
    // which memory/shared/<group>/ directories this dream may write (spec 32).
    clearance: resolveClearanceForEmail(identity.email),
  });
  if (status === "committed" || status === "nothing") markDreamed(getDb(), parsed.sessionId);

  log.info("memory end-and-save complete", {
    route: "POST /api/agent/memory/end",
    owner: identity.email,
    sessionId: parsed.sessionId,
    status,
  });
  return Response.json({ status });
}
