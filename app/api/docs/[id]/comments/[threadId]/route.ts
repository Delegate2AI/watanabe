import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import type { Identity } from "@/lib/auth/types";
import { getDb } from "@/lib/db/client";
import { addReply, setThreadStatus } from "@/lib/db/comment-threads";
import { accessFor, canRead, canComment } from "@/lib/shared-docs/access";
import { requireEnabledIdentity, notFound } from "@/lib/shared-docs/authorize";
import { isDocAnnotationsEnabled } from "@/lib/shared-docs/config";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Per-thread actions on an anchored comment thread (spec 2026-07-22, gated by
 * DOC_ANNOTATIONS_ENABLED): POST replies, PATCH resolves/reopens. Flag-off,
 * an unknown doc, or a denied caller all resolve to the shared 404 (no
 * oracle); insufficient tier (view-only) gets 403.
 */

const forbidden = () => fail("needs_role", { detail: "comment" });
const ReplyBody = z.object({ body: z.string().min(1) });
const StatusBody = z.object({ status: z.enum(["open", "resolved"]) });

type Ctx = { params: Promise<{ id: string; threadId: string }> };

async function gate(
  request: Request,
  id: string,
): Promise<{ response: Response } | { identity: Identity; db: DatabaseType }> {
  const g = await requireEnabledIdentity(request);
  if ("response" in g) return { response: g.response };
  const db = getDb();
  const access = accessFor(db, id, g.identity.email);
  if (!canRead(access)) return { response: notFound() };
  if (!canComment(access)) return { response: forbidden() };
  return { identity: g.identity, db };
}

/** POST -> append a reply to the thread (comment/edit access). */
export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  // The annotation flag is checked before anything else -- identity
  // resolution, body parsing -- so flag-off is a uniform 404 dark surface,
  // never a 401 (unauthenticated) or 400 (malformed body) leaking that the
  // subsystem exists but is disabled.
  if (!isDocAnnotationsEnabled()) return notFound();
  const { id, threadId } = await params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = ReplyBody.safeParse(json);
  if (!parsed.success || parsed.data.body.trim() === "") {
    return fail("invalid_request", { detail: "body" });
  }
  const g = await gate(request, id);
  if ("response" in g) return g.response;
  try {
    const ok = addReply(g.db, {
      id: randomUUID(),
      threadId,
      docId: id,
      authorEmail: g.identity.email,
      body: parsed.data.body,
      createdAt: new Date().toISOString(),
    });
    if (!ok) return notFound();
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    log.error("shared-docs request failed", { route: "POST /api/docs/[id]/comments/[threadId]", status: 500, err: String(e) });
    return fail("internal");
  }
}

/** PATCH -> resolve or reopen the thread (comment/edit access). */
export async function PATCH(request: Request, { params }: Ctx): Promise<Response> {
  // See POST above: flag check first, before identity or body parsing.
  if (!isDocAnnotationsEnabled()) return notFound();
  const { id, threadId } = await params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = StatusBody.safeParse(json);
  if (!parsed.success) return fail("invalid_request", { detail: "status" });
  const g = await gate(request, id);
  if ("response" in g) return g.response;
  try {
    const ok = setThreadStatus(
      g.db,
      threadId,
      id,
      parsed.data.status,
      parsed.data.status === "resolved" ? g.identity.email : null,
      new Date().toISOString(),
    );
    if (!ok) return notFound();
    return Response.json({ ok: true });
  } catch (e) {
    log.error("shared-docs request failed", { route: "PATCH /api/docs/[id]/comments/[threadId]", status: 500, err: String(e) });
    return fail("internal");
  }
}
