import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { reclearMeeting } from "@/lib/authority/reclearance";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    notePath: z.string().min(1),
    visibility: z.array(z.string().min(1)).min(1),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return fail("needs_role");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  const result = await reclearMeeting(parsed.data.notePath, parsed.data.visibility, actorEmail);
  if (!result.ok) {
    // The re-clearance writer's own sentence stays in the log. Only the shape of
    // the refusal travels: a role denial, a deployment that cannot write, a
    // branch that reached the remote without a merge request, or a request we
    // will not act on. The branch name stays out of the body even in the
    // `review_unavailable` case, where the writer has already logged it.
    if (result.error === "forbidden") return fail("needs_role");
    if (result.error === "write_unavailable") return fail("write_unavailable");
    if (result.error === "review_unavailable") return fail("review_unavailable");
    return fail("invalid_request", { detail: "notePath" });
  }
  return Response.json({ branch: result.branch, mrUrl: result.mrUrl });
}
