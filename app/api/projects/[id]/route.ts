import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import {
  getProjectForRequester,
  updateProject,
  attachThread,
  attachTask,
  listThreads,
  listTasks,
} from "@/lib/db/projects";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { isProjectsEnabled } from "@/lib/projects/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Foreign and unknown ids share this 404 so the route is no existence oracle. */
const NOT_FOUND = () => fail("not_found");

const PatchBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    context: z.string().trim().max(8000).nullable().optional(),
  }),
  z.object({ action: z.literal("attachThread"), threadId: z.string().min(1) }),
  z.object({ action: z.literal("attachTask"), taskId: z.string().min(1) }),
]);

/**
 * GET /api/projects/[id] -> a cleared project with its viewer-scoped threads and
 * tasks (spec 26). Foreign or unknown id both 404 (no oracle). Flag-off 404s.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isProjectsEnabled()) return NOT_FOUND();
  const { id } = await params;

  try {
    const email = auth.identity.email;
    const clearance = resolveClearance(email, loadGroups());
    const project = getProjectForRequester(getDb(), id, email, clearance);
    if (!project) return NOT_FOUND();
    return Response.json({
      project,
      threads: listThreads(getDb(), id, email, clearance),
      tasks: listTasks(getDb(), id, email, clearance),
    });
  } catch (error) {
    log.error("projects request failed", { route: "GET /api/projects/[id]", error: String(error) });
    return fail("internal");
  }
}

/**
 * PATCH /api/projects/[id] -> update (owner only) or attach a thread/task
 * (visibility-guarded). A project the caller cannot see 404s (no oracle). A
 * cleared non-owner updating gets 403 (they can see it, just not edit it). A
 * failed attach guard is a 400 (bad content, not a hidden project).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isProjectsEnabled()) return NOT_FOUND();
  const { id } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch (error) {
    // The zod issue names the offending field and is logged, never returned:
    // the response body carries a code and a field name, not a sentence.
    log.info("project patch rejected", { route: "PATCH /api/projects/[id]", error: String(error) });
    return fail("invalid_request", { detail: "body" });
  }

  try {
    const email = auth.identity.email;
    const clearance = resolveClearance(email, loadGroups());
    const project = getProjectForRequester(getDb(), id, email, clearance);
    if (!project) return NOT_FOUND();

    if (body.action === "update") {
      if (project.ownerEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
        return fail("needs_role", { detail: "owner" });
      }
      const ok = updateProject(getDb(), id, email, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.context !== undefined ? { context: body.context } : {}),
      });
      return ok ? Response.json({ ok: true }) : fail("invalid_request", { detail: "patch" });
    }

    const attached = body.action === "attachThread"
      ? attachThread(getDb(), id, body.threadId, email, clearance)
      : attachTask(getDb(), id, body.taskId, email, clearance);
    return attached ? Response.json({ ok: true }) : fail("invalid_request", { detail: "target" });
  } catch (error) {
    log.error("projects request failed", { route: "PATCH /api/projects/[id]", error: String(error) });
    return fail("internal");
  }
}
