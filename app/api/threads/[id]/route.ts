import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { setThreadPinned, setThreadTitle, deleteThread, setThreadModelChoice } from "@/lib/db/threads";
import { EFFORT_LEVELS, isAllowedModel } from "@/lib/agent/model-options";
import { dropWarmSession } from "@/lib/agent/session";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Either toggle pin OR set the model/effort override in one PATCH. Both fields
 * are optional; the model choice is validated against the allowlist here (an
 * off-list model or a bogus effort is a 400) so a bad value never reaches the
 * store or the SDK.
 */
const Body = z.object({
  pinned: z.boolean().optional(),
  title: z.string().trim().min(1, "title is required").max(200).optional(),
  model: z.string().refine(isAllowedModel, "model is not on the allowlist").optional(),
  effort: z.enum(EFFORT_LEVELS as unknown as [string, ...string[]]).optional(),
});

/**
 * PATCH /api/threads/[id] → toggle `pinned` and/or set the model/effort override.
 *
 * Identity-scoped at the store layer: the setters only update a row that both
 * exists AND belongs to the caller, returning `false` otherwise. A `false`
 * becomes a 404, keeping a foreign id and an unknown id indistinguishable (no
 * existence oracle), the same ownership contract the agent routes use.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("threads request rejected", { route: "PATCH /api/threads/[id]", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;
  const { id } = await params;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    let updated = false;
    if (parsed.pinned !== undefined) {
      updated = setThreadPinned(getDb(), id, identity.email, parsed.pinned) || updated;
    }
    if (parsed.title !== undefined) {
      updated = setThreadTitle(getDb(), id, identity.email, parsed.title) || updated;
    }
    if (parsed.model !== undefined || parsed.effort !== undefined) {
      // Only the present fields are written, so changing effort alone never
      // clobbers a previously-chosen model (and vice versa).
      const modelUpdated = setThreadModelChoice(getDb(), id, identity.email, {
        model: parsed.model,
        effort: parsed.effort,
      });
      updated = modelUpdated || updated;
      // Refresh a warm session so the new choice takes effect on the NEXT turn
      // rather than waiting for idle eviction (spec 24 per-chat switching).
      if (modelUpdated) dropWarmSession(id);
    }
    if (!updated) {
      log.warn("threads request rejected", {
        route: "PATCH /api/threads/[id]",
        status: 404,
        reason: "not found or not owned",
        owner: identity.email,
        threadId: id,
      });
      return fail("not_found");
    }
    return Response.json({ id, pinned: parsed.pinned, title: parsed.title, model: parsed.model, effort: parsed.effort });
  } catch (e) {
    log.error("threads request failed", {
      route: "PATCH /api/threads/[id]",
      status: 500,
      owner: identity.email,
      threadId: id,
      err: String(e),
    });
    return fail("internal");
  }
}

/**
 * DELETE /api/threads/[id] → remove a thread from the caller's chat lists.
 *
 * Owner-scoped exactly like PATCH: `deleteThread` only removes a row that both
 * exists AND belongs to the caller, so a foreign or unknown id 404s (no
 * existence oracle). The warm session is dropped so a deleted chat cannot keep a
 * subprocess alive in the background; the on-disk SDK session is left in place
 * but is unreachable, since resume now fails its ownership check.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("threads request rejected", { route: "DELETE /api/threads/[id]", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;
  const { id } = await params;

  try {
    const deleted = deleteThread(getDb(), id, identity.email);
    if (!deleted) {
      log.warn("threads request rejected", {
        route: "DELETE /api/threads/[id]",
        status: 404,
        reason: "not found or not owned",
        owner: identity.email,
        threadId: id,
      });
      return fail("not_found");
    }
    // Best-effort resource cleanup: a cold/evicted session is already gone.
    dropWarmSession(id);
    return Response.json({ id, deleted: true });
  } catch (e) {
    log.error("threads request failed", {
      route: "DELETE /api/threads/[id]",
      status: 500,
      owner: identity.email,
      threadId: id,
      err: String(e),
    });
    return fail("internal");
  }
}
