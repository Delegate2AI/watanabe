import crypto from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { deletePackage, insertPackage, listPackagesForOwner } from "@/lib/db/packages";
import { fail } from "@/lib/errors/codes";
import { isPackagesEnabled, maxTotalBytes, packageDir } from "@/lib/packages/config";
import { normalizePackage, writeMeta, type UploadPart } from "@/lib/packages/normalize";
import { enqueuePackage } from "@/lib/packages/queue";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/packages: upload a doc package (a single zip, or one-or-more
 * loose files) for later background integration into the knowledge base.
 *
 * A `Content-Length` header is required up front: missing or non-positive
 * gets a 411 before the body is touched at all, so a client can never force
 * `request.formData()` to buffer an unbounded chunked-encoded body straight
 * into memory. Size is then checked twice: first cheaply off that header
 * (before the body is even read, so an oversized upload never has its bytes
 * pulled off the wire), then again against the actual bytes collected from
 * the parsed multipart body (a client can lie about that header, just not
 * omit it). Either size check failing is a 413. A package id
 * (`crypto.randomUUID()`) is minted only once every check passes, and only
 * used if `normalizePackage` accepts the upload: its `{ok:false}` result maps
 * straight to a 400 carrying its own rejection message.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isPackagesEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("packages request rejected", { route: "POST /api/packages", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  const contentLengthHeader = request.headers.get("content-length");
  const declaredLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
  if (!Number.isInteger(declaredLength) || declaredLength <= 0) {
    log.warn("packages request rejected", {
      route: "POST /api/packages",
      status: 411,
      reason: "missing or invalid content-length",
      owner: identity.email,
    });
    return fail("invalid_request", { status: 411, detail: "content-length" });
  }
  if (declaredLength > maxTotalBytes()) {
    log.warn("packages request rejected", {
      route: "POST /api/packages",
      status: 413,
      reason: "declared content-length exceeds max",
      owner: identity.email,
    });
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    log.warn("packages request rejected", {
      route: "POST /api/packages",
      status: 400,
      reason: "invalid multipart body",
      owner: identity.email,
    });
    return fail("invalid_request", { detail: "body" });
  }

  const parts: UploadPart[] = [];
  for (const value of formData.values()) {
    if (value instanceof File) {
      const data = Buffer.from(await value.arrayBuffer());
      parts.push({ filename: value.name, data });
    }
  }

  const totalBytes = parts.reduce((sum, part) => sum + part.data.length, 0);
  if (totalBytes > maxTotalBytes()) {
    log.warn("packages request rejected", {
      route: "POST /api/packages",
      status: 413,
      reason: "uploaded bytes exceed max",
      owner: identity.email,
    });
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  const id = crypto.randomUUID();
  const result = await normalizePackage(parts, id);
  if (!result.ok) {
    log.warn("packages request rejected", {
      route: "POST /api/packages",
      status: 400,
      reason: "normalize failed",
      owner: identity.email,
      packageId: id,
      error: result.error,
    });
    // `normalizePackage` names what it rejected. That sentence is already in
    // the log line above; the body carries the code and the field only.
    return fail("invalid_request", { detail: "package" });
  }

  try {
    await writeMeta(id, {
      ownerEmail: identity.email,
      originalNames: parts.map((part) => part.filename),
      fileCount: result.fileCount,
      receivedAt: new Date().toISOString(),
    });

    insertPackage(getDb(), { id, ownerEmail: identity.email, ownerName: identity.name, name: result.name });
    enqueuePackage(id);
  } catch (e) {
    // Normalization already landed files on disk (and `insertPackage` may
    // have committed a row) before the failing step; a 500 must not leak an
    // orphaned `<packagesRoot()>/<id>/` directory, nor a queued row pointing
    // at a directory this cleanup is about to remove. Both removals are
    // idempotent no-ops when their step never ran.
    await rm(path.dirname(packageDir(id)), { recursive: true, force: true }).catch(() => {});
    try {
      deletePackage(getDb(), id);
    } catch {
      // The DB itself may be what failed; the row (if any) is recoverable
      // noise compared to failing to report the 500 below.
    }
    log.error("packages request failed", {
      route: "POST /api/packages",
      status: 500,
      reason: "failed to record uploaded package",
      owner: identity.email,
      packageId: id,
      err: String(e),
    });
    return fail("internal");
  }

  log.info("package uploaded", {
    route: "POST /api/packages",
    owner: identity.email,
    packageId: id,
    name: result.name,
    fileCount: result.fileCount,
  });
  return Response.json({ id, name: result.name, status: "queued" }, { status: 201 });
}

/**
 * GET /api/packages: the caller's own packages, newest activity first.
 * `report` is deliberately omitted from each record: it can be a large
 * integration writeup, only worth fetching for one package at a time via
 * `GET /api/packages/[id]`, not paid for on every list refresh.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isPackagesEnabled()) return fail("not_found");

  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("packages request rejected", { route: "GET /api/packages", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  const packages = listPackagesForOwner(getDb(), identity.email).map((p) => ({
    id: p.id,
    ownerEmail: p.ownerEmail,
    ownerName: p.ownerName,
    name: p.name,
    status: p.status,
    threadId: p.threadId,
    mrUrl: p.mrUrl,
    error: p.error,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
  return Response.json({ packages });
}
