import fs from "node:fs";
import path from "node:path";
import { requireIdentity } from "@/lib/auth/identity";
import { attachmentDirFor, isAttachmentsEnabled } from "@/lib/attachments/store";
import { listAttachments } from "@/lib/attachments/read";
import { dropWarmSessionSoon } from "@/lib/agent/session-factory";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("attachments request rejected", {
      route: "DELETE /api/attachments/[id]",
      status: 401,
      reason: "unauthorized",
    });
    return auth.response;
  }
  const { identity } = auth;
  if (!isAttachmentsEnabled()) return fail("not_found");

  const threadId = new URL(request.url).searchParams.get("threadId")?.trim() ?? "";
  if (!threadId) return fail("invalid_request", { detail: "threadId" });
  if (!isOwnedBy(getDb(), threadId, identity.email)) return fail("not_found");

  const { id } = await ctx.params;
  const target = listAttachments(identity.email, threadId).find((a) => a.id === id);
  if (!target) return fail("not_found");

  const dir = attachmentDirFor(identity.email, threadId);
  if (path.dirname(target.path) !== fs.realpathSync(dir)) return fail("not_found");

  try {
    fs.unlinkSync(target.path);
  } catch (e) {
    log.error("attachments request failed", {
      route: "DELETE /api/attachments/[id]",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
  dropWarmSessionSoon(threadId);
  log.info("attachment deleted", { route: "DELETE /api/attachments/[id]", owner: identity.email, threadId });
  return Response.json({ deleted: true });
}
