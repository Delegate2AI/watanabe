import { requireIdentity } from "@/lib/auth/identity";
import {
  isAttachmentsEnabled,
  validateAttachment,
  storeAttachment,
  maxAttachmentBytes,
} from "@/lib/attachments/store";
import { listAttachments } from "@/lib/attachments/read";
import { dropWarmSessionSoon } from "@/lib/agent/session-factory";
import { getDb } from "@/lib/db/client";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/attachments (multipart) → store one file for the caller, scoped to
 * a thread, and return the composer chip.
 *
 * Identity-scoped: the owner segment of the storage path is the AUTHENTICATED
 * email, never a client field, so one user's upload can only land under their
 * own slug (`lib/attachments/store.ts`). The file lands OUTSIDE the KB vault, so
 * it never becomes KB content and never widens a session's clearance. Gated by
 * `ATTACHMENTS_ENABLED`: flag-off the route 404s and the composer disables the
 * `+` with a tooltip, leaving every existing byte-path identical.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("attachments request rejected", { route: "POST /api/attachments", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  if (!isAttachmentsEnabled()) return fail("not_found");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  const file = form.get("file");
  const threadId = String(form.get("threadId") ?? "").trim();
  if (!(file instanceof File)) return fail("invalid_request", { detail: "file" });
  if (!threadId) return fail("invalid_request", { detail: "threadId" });

  // The thread must exist AND belong to the caller. `isOwnedBy` is false for a
  // foreign id AND an unknown one, and both return the SAME 404 here, so a user
  // can neither write into another's thread nor probe which thread ids exist (no
  // existence oracle). This closes the "any client threadId is accepted" hole.
  if (!isOwnedBy(getDb(), threadId, identity.email)) {
    log.warn("attachments request rejected", {
      route: "POST /api/attachments",
      status: 404,
      reason: "not found or not owned",
      owner: identity.email,
      threadId,
    });
    return fail("not_found");
  }

  const mimeType = file.type || "application/octet-stream";
  const check = validateAttachment({ mimeType, size: file.size, filename: file.name || "attachment" });
  if (!check.ok) {
    const code = file.size > maxAttachmentBytes() ? "file_too_large" : "unsupported_file";
    log.warn("attachments request rejected", {
      route: "POST /api/attachments",
      status: code === "file_too_large" ? 413 : 400,
      reason: "validation",
      owner: identity.email,
      mimeType,
      size: file.size,
    });
    return fail(code);
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const attachment = storeAttachment({
      ownerEmail: identity.email,
      threadId,
      filename: file.name || "attachment",
      mimeType,
      bytes,
    });
    log.info("attachment stored", {
      route: "POST /api/attachments",
      owner: identity.email,
      threadId,
      size: attachment.size,
    });
    dropWarmSessionSoon(threadId);
    return Response.json({ attachment });
  } catch (e) {
    log.error("attachments request failed", {
      route: "POST /api/attachments",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("attachments request rejected", { route: "GET /api/attachments", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;
  if (!isAttachmentsEnabled()) return fail("not_found");

  const threadId = new URL(request.url).searchParams.get("threadId")?.trim() ?? "";
  if (!threadId) return fail("invalid_request", { detail: "threadId" });
  if (!isOwnedBy(getDb(), threadId, identity.email)) return fail("not_found");

  const attachments = listAttachments(identity.email, threadId).map((a) => ({
    type: "attachment" as const,
    id: a.id,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    threadId,
  }));
  return Response.json({ attachments });
}
