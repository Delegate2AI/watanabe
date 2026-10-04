import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { isKnownMember, loadGroups } from "@/lib/authority/groups";
import { can } from "@/lib/authority/roles";
import { fail } from "@/lib/errors/codes";
import { isPeopleEnabled } from "@/lib/people/config";
import { loadPeople, upsertPerson } from "@/lib/people/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A name is presentation text, not a key or a path: cap the length so one row
// cannot blow up every list that renders it, and keep it on one line.
const bodySchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(120).refine((value) => !/[\r\n]/.test(value), {
    message: "name must be a single line",
  }),
}).strict();

/**
 * Admin edit of a person's display name. Writes `source: "manual"`, which is
 * sticky: the next sign-in will not overwrite the correction with the name the
 * identity provider sends.
 */
export async function PATCH(request: Request): Promise<Response> {
  // Flag first, before auth. Checking auth first makes a disabled route answer
  // 401 and 403 where it used to answer the framework's 404, which tells an
  // unauthenticated caller the route exists. Flag-off must be indistinguishable
  // from not shipped.
  if (!isPeopleEnabled()) return new Response(null, { status: 404 });
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return fail("needs_role");
  if (!isPeopleEnabled()) return fail("not_found");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  const email = parsed.data.email.trim().toLowerCase();
  // Only people who already exist in the access data can be named: the
  // directory is a view over the roster, not a way to invent new members.
  if (!isKnownMember(email, loadGroups())) return fail("not_found");

  const name = parsed.data.name.trim();
  await upsertPerson(email, { name, source: "manual" }, { actorEmail });
  // upsertPerson swallows a refused commit by contract (it also runs behind
  // identity resolution, which must never fail). An admin who just typed a name
  // deserves the truth, so confirm the write landed before reporting success.
  if (loadPeople()[email]?.name !== name) return fail("internal", { status: 502 });
  return Response.json({ email, name });
}
