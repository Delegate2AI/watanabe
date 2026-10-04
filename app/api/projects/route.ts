import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { getDb } from "@/lib/db/client";
import { createProject, listProjectSummariesForRequester } from "@/lib/db/projects";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { isProjectsEnabled } from "@/lib/projects/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_NAME = 120;

const CreateBody = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  description: z.string().trim().max(2000).optional(),
  context: z.string().trim().max(8000).optional(),
  clearance: z.array(z.string().min(1)).optional(),
});

/**
 * GET /api/projects -> the caller's cleared projects as summaries (spec 26).
 * Flag-off (`PROJECTS_ENABLED` unset) returns an empty surface so the byte-path
 * is unchanged. Clearance-scoped: only projects the caller owns or is cleared
 * for are returned, with viewer-scoped counts (no existence oracle).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isProjectsEnabled()) return Response.json({ projects: [] });

  try {
    const clearance = resolveClearanceForEmail(auth.identity.email);
    return Response.json({ projects: listProjectSummariesForRequester(getDb(), auth.identity.email, clearance) });
  } catch (error) {
    log.error("projects request failed", { route: "GET /api/projects", error: String(error) });
    return fail("internal");
  }
}

/**
 * POST /api/projects -> create a project owned by the caller (spec 26).
 *
 * Clearance defaults to the caller's own clearance; an explicit `clearance` must
 * be a SUBSET of the caller's clearance, so a contributor can never mint a
 * project cleared for a group they are not in (no privilege escalation, and no
 * widening of KB access). Flag-off, this route 404s so no project can be made.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isProjectsEnabled()) return fail("not_found");

  let parsed: z.infer<typeof CreateBody>;
  try {
    parsed = CreateBody.parse(await request.json());
  } catch (error) {
    log.info("project create rejected", { route: "POST /api/projects", error: String(error) });
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const email = auth.identity.email;
    const ownClearance = resolveClearanceForEmail(email);
    let clearance = ownClearance;
    if (parsed.clearance && parsed.clearance.length > 0) {
      const allowed = new Set(ownClearance);
      if (!parsed.clearance.every((group) => allowed.has(group))) {
        return fail("invalid_request", { detail: "clearance" });
      }
      clearance = parsed.clearance;
    }
    const id = randomUUID();
    createProject(getDb(), {
      id,
      name: parsed.name,
      description: parsed.description ?? null,
      context: parsed.context ?? null,
      clearance,
      ownerEmail: email,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ project: { id, name: parsed.name, clearance } }, { status: 201 });
  } catch (error) {
    log.error("projects request failed", { route: "POST /api/projects", error: String(error) });
    return fail("internal");
  }
}
