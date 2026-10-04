import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import {
  attachableFor,
  insertProjectReference,
  deleteProjectReference,
  resolveKbTarget,
  resolveProjectReferences,
} from "@/lib/db/project-references";
import { searchKb } from "@/lib/kb/search";
import { vaultRootFor } from "@/lib/repo";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { authorizeProject, NOT_FOUND } from "../documents/authorize";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Project references (surface-polish P-05): attach content that already exists
 * (an artifact, a shared doc, a knowledge-base note) to a project without
 * copying it.
 *
 * Authorized by the PROJECT, exactly as project documents are, through the
 * shared seam in `../documents/authorize.ts`. What may be ATTACHED is a separate
 * question, answered by the target's own rules. For artifacts and shared docs
 * the candidate list is built only from what the requester can already reach, so
 * a reference can never be minted for content the requester cannot see. A KB
 * note is not enumerable, so it is authorized by resolution against the
 * requester's clearance projection instead, which gives the same property: a
 * restricted note and an invented path both fail to resolve. The read path
 * re-resolves either way, so a later revocation drops the row out of the view on
 * its own.
 */

const AttachBody = z.object({
  kind: z.enum(["artifact", "shared_doc", "kb"]),
  targetId: z.string().min(1),
});
const DetachBody = z.object({ referenceId: z.string().min(1) });

/** How many KB search hits the picker offers. */
const KB_CANDIDATE_LIMIT = 20;

/**
 * GET -> the project's visible references plus what the caller could attach.
 *
 * `?q=` searches the knowledge base for attachable notes, scoped to the
 * caller's projection. It rides on this route rather than a new one so the KB
 * candidate list sits behind the same project authorization as everything else
 * here. A blank query returns none: there is no browse-the-vault mode, that is
 * what `/kb` is for.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeProject(request, id);
  if ("response" in authz) return authz.response;
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  try {
    const kbCandidates = query
      ? (await searchKb(query, vaultRootFor(authz.clearance)))
          .slice(0, KB_CANDIDATE_LIMIT)
          .map((row) => ({ kind: "kb" as const, targetId: row.relPath, title: row.title }))
      : [];
    return Response.json({
      references: resolveProjectReferences(getDb(), id, authz.email, authz.clearance),
      candidates: attachableFor(getDb(), authz.email),
      kbCandidates,
    });
  } catch (error) {
    log.error("project references request failed", { route: "GET /api/projects/[id]/references", error: String(error) });
    return fail("internal");
  }
}

/** POST -> attach one artifact or shared doc the caller can already reach. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeProject(request, id);
  if ("response" in authz) return authz.response;

  let body: z.infer<typeof AttachBody>;
  try {
    body = AttachBody.parse(await request.json());
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    // Whichever way the kind is authorized, the answer to "you may not" and to
    // "there is no such thing" is the same 404 (no oracle).
    //
    // kb: the note has to resolve inside the requester's own clearance
    // projection, and what gets stored is the resolved on-disk path, never the
    // spelling the caller sent. `a/b` and `a/b.md` are the same note, and only
    // one canonical form keeps the UNIQUE (project, kind, target) constraint
    // able to see that.
    //
    // artifact / shared_doc: the candidate list IS the authorization. A target
    // the requester cannot reach is not in it, so it can never be attached.
    let targetId = body.targetId;
    if (body.kind === "kb") {
      const note = resolveKbTarget(body.targetId, authz.clearance);
      if (!note) return NOT_FOUND();
      targetId = note.relPath;
    } else {
      const allowed = attachableFor(getDb(), authz.email).some(
        (c) => c.kind === body.kind && c.targetId === body.targetId,
      );
      if (!allowed) return NOT_FOUND();
    }
    insertProjectReference(getDb(), {
      id: randomUUID(),
      projectId: id,
      kind: body.kind,
      targetId,
      addedBy: authz.email,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ references: resolveProjectReferences(getDb(), id, authz.email, authz.clearance) });
  } catch (error) {
    log.error("project references request failed", { route: "POST /api/projects/[id]/references", error: String(error) });
    return fail("internal");
  }
}

/** DELETE -> detach one reference. The target itself is never touched. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const authz = await authorizeProject(request, id);
  if ("response" in authz) return authz.response;

  let body: z.infer<typeof DetachBody>;
  try {
    body = DetachBody.parse(await request.json());
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  try {
    if (!deleteProjectReference(getDb(), id, body.referenceId)) return NOT_FOUND();
    return Response.json({ ok: true });
  } catch (error) {
    log.error("project references request failed", { route: "DELETE /api/projects/[id]/references", error: String(error) });
    return fail("internal");
  }
}
