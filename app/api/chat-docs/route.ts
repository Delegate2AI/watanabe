import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { listForThread } from "@/lib/db/chat-docs";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { isCanvasEnabled } from "@/lib/canvas/config";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Foreign, unknown, and flag-off all share this 404 (no existence oracle). */
const NOT_FOUND = () => fail("not_found");

/**
 * GET /api/chat-docs?thread=<id> -> the chat documents bound to a thread the
 * caller owns, for resume hydration (spec 29): the client re-renders their cards
 * and opens one to load its versions.
 *
 * Owner + thread scoped: the caller must own the source thread (`isOwnedBy`), and
 * `listForThread` filters to their own email. A foreign OR unknown thread id both
 * fail the ownership check and return the SAME 404 (no existence oracle).
 * Flag-off is a 404 too, so the surface stays dark and byte-identical.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isCanvasEnabled()) return NOT_FOUND();

  const thread = new URL(request.url).searchParams.get("thread")?.trim();
  if (!thread) return fail("invalid_request", { detail: "thread" });

  try {
    if (!isOwnedBy(getDb(), thread, auth.identity.email)) return NOT_FOUND();
    const docs = listForThread(getDb(), thread, auth.identity.email).map((d) => ({
      id: d.id,
      title: d.title,
      currentVersion: d.currentVersion,
      updatedAt: d.updatedAt,
    }));
    return Response.json({ docs });
  } catch (e) {
    log.error("chat-docs request failed", { route: "GET /api/chat-docs", status: 500, err: String(e) });
    return fail("internal");
  }
}
