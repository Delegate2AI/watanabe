import { rm } from "node:fs/promises";
import path from "node:path";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { deletePackage, getPackage } from "@/lib/db/packages";
import { fail } from "@/lib/errors/codes";
import { isPackagesEnabled, packageDir } from "@/lib/packages/config";
import { discard, worktreeExists } from "@/lib/repo-write";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Unknown and foreign ids share this 403, so the route is no existence oracle. */
const FORBIDDEN = () => fail("not_cleared");

/**
 * GET /api/packages/[id]: the full record for one package, plus `draftLive`
 * (whether its integration thread still has a live worktree, i.e. a draft MR
 * that hasn't been submitted or discarded yet).
 *
 * An unknown id and a foreign id are both 403, never distinguished: same
 * "no existence oracle" posture as `GET /api/agent/sessions?id=`.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  if (!isPackagesEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("packages request rejected", { route: "GET /api/packages/[id]", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;
  const { id } = await context.params;

  const record = getPackage(getDb(), id);
  if (!record || record.ownerEmail !== identity.email) {
    log.warn("packages request rejected", {
      route: "GET /api/packages/[id]",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      packageId: id,
    });
    return FORBIDDEN();
  }

  const draftLive = record.threadId ? worktreeExists(record.threadId) : false;
  return Response.json({ ...record, draftLive });
}

/**
 * DELETE /api/packages/[id]: remove a package: its DB row, its on-disk
 * upload directory, and (if it has one) its integration worktree.
 *
 * Refused with 409 while the package is `queued` or `processing`: deleting
 * out from under an upload that's about to run, or currently running, would
 * either race the job's own reads of `packageDir(id)` or leave `enqueuePackage`
 * chasing an id nothing can find anymore. `failed`, `no_changes`, and
 * `submitted` are all safe to delete.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!isPackagesEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("packages request rejected", {
      route: "DELETE /api/packages/[id]",
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
      route: "DELETE /api/packages/[id]",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      packageId: id,
    });
    return FORBIDDEN();
  }

  if (record.status === "queued" || record.status === "processing") {
    log.warn("packages request rejected", {
      route: "DELETE /api/packages/[id]",
      status: 409,
      reason: "package is still in flight",
      owner: identity.email,
      packageId: id,
      packageStatus: record.status,
    });
    return fail("wrong_status");
  }

  try {
    if (record.threadId) {
      await discard(record.threadId);
    }

    // The package's whole `<packagesRoot()>/<id>/` directory, derived from the
    // SAME `packageDir(id)` the rest of the intake pipeline uses (its parent),
    // so removal is containment-safe for the identical reason writes into it
    // are: `packageDir` throws for anything that isn't a safe path segment.
    const idRoot = path.dirname(packageDir(id));
    await rm(idRoot, { recursive: true, force: true });

    deletePackage(db, id);
  } catch (e) {
    log.error("packages request failed", {
      route: "DELETE /api/packages/[id]",
      status: 500,
      reason: "failed to delete package",
      owner: identity.email,
      packageId: id,
      err: String(e),
    });
    return fail("internal");
  }

  log.info("package deleted", { route: "DELETE /api/packages/[id]", owner: identity.email, packageId: id });
  return Response.json({ ok: true });
}
