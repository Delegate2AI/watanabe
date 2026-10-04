import { statSync } from "node:fs";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { checkDraftAccess } from "@/lib/agent/draft-access";
import { fail } from "@/lib/errors/codes";
import { changedFiles, worktreePath } from "@/lib/repo-write";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/agent/draft?sessionId=<id> -> { exists, changedFiles, updatedAt }
 *
 * Spec 12 D25 — lets the chat panel ("ChatContextProvider"'s `draftState`,
 * see `components/agent/agent-chat.tsx`) discover its own session's staged
 * draft, independent of the vault page's own render. The vault page itself
 * never calls this route — it computes the identical data server-side in its
 * own request via `checkDraftAccess`/`changedFiles` directly (see
 * `app/(site)/[[...slug]]/page.tsx`), so this route exists purely for the
 * chat's client-side state, not as the single source of truth for the view.
 *
 * `"own-but-gone"` (a real, expected state — the draft was submitted,
 * discarded, or never staged) is a 200 `{exists:false}`, not an error; only
 * shape/ownership failures 403.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", { route: "GET /api/agent/draft", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    log.warn("agent request rejected", {
      route: "GET /api/agent/draft",
      status: 400,
      reason: "missing sessionId",
      owner: identity.email,
    });
    return fail("invalid_request", { detail: "sessionId" });
  }

  const access = checkDraftAccess(getDb(), sessionId, identity.email);
  if (access === "invalid-or-forbidden") {
    log.warn("agent request rejected", {
      route: "GET /api/agent/draft",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      sessionId,
    });
    return fail("not_cleared");
  }
  if (access === "own-but-gone") {
    return Response.json({ exists: false, changedFiles: [], updatedAt: null });
  }

  try {
    const files = await changedFiles(sessionId);
    // turbopackIgnore: the path is a runtime-computed worktree path, not a
    // project file — same rationale as lib/repo-write.ts's dynamic fs calls.
    const updatedAt = statSync(/* turbopackIgnore: true */ worktreePath(sessionId)).mtime.toISOString();
    return Response.json({ exists: true, changedFiles: files, updatedAt });
  } catch (e) {
    log.error("agent request failed", {
      route: "GET /api/agent/draft",
      status: 500,
      reason: "failed to read draft state",
      owner: identity.email,
      sessionId,
      err: String(e),
    });
    return fail("internal");
  }
}
