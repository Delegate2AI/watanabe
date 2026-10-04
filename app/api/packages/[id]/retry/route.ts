import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { getPackage, requeueForRetry } from "@/lib/db/packages";
import { fail } from "@/lib/errors/codes";
import { isPackagesEnabled } from "@/lib/packages/config";
import { enqueuePackage } from "@/lib/packages/queue";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/packages/[id]/retry: requeue a `failed`/`no_changes` package for
 * another integration run.
 *
 * `requeueForRetry` (see `lib/db/packages.ts`) is the sole gate on WHICH
 * statuses may retry: it refuses `queued`/`processing`/`submitted`,
 * returning `false` (no row touched) for any of those, which this route maps
 * to 409. Only on that guard passing does it enqueue a fresh run, so a 409
 * never has a side effect.
 *
 * This route deliberately does NOT discard the previous run's worktree
 * itself: `runPackageJob` (`lib/packages/runner.ts`) discards any
 * pre-existing worktree for the thread id at the start of every run, so a
 * stale worktree from the run this retry supersedes is handled there. Doing
 * it here too would reintroduce the exact wedge this comment used to
 * describe: flipping the row to `queued` before an awaited `discard()` that
 * could throw would leave it queued-but-never-enqueued, and DELETE 409s on a
 * `queued` row, so a mid-request crash here used to be able to wedge a
 * package until a server restart. Enqueueing is synchronous and cannot fail
 * this way.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!isPackagesEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("packages request rejected", {
      route: "POST /api/packages/[id]/retry",
      status: 401,
      reason: "unauthorized",
    });
    return auth.response;
  }
  const { identity } = auth;
  const { id } = await context.params;

  const db = getDb();
  const record = getPackage(db, id);
  if (!record || record.ownerEmail !== identity.email) {
    log.warn("packages request rejected", {
      route: "POST /api/packages/[id]/retry",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      packageId: id,
    });
    // Unknown and foreign ids share this 403 (no existence oracle).
    return fail("not_cleared");
  }

  if (!requeueForRetry(db, id)) {
    log.warn("packages request rejected", {
      route: "POST /api/packages/[id]/retry",
      status: 409,
      reason: "package is not in a retryable state",
      owner: identity.email,
      packageId: id,
      packageStatus: record.status,
    });
    return fail("wrong_status");
  }

  try {
    enqueuePackage(id);
  } catch (e) {
    log.error("packages request failed", {
      route: "POST /api/packages/[id]/retry",
      status: 500,
      reason: "failed to requeue package",
      owner: identity.email,
      packageId: id,
      err: String(e),
    });
    return fail("internal");
  }

  log.info("package requeued for retry", {
    route: "POST /api/packages/[id]/retry",
    owner: identity.email,
    packageId: id,
  });
  return Response.json({ ok: true });
}
