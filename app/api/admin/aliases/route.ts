import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { loadAliasMap, writeAlias, type AliasFailure } from "@/lib/authority/aliases-store";
import { isAliasAdminEnabled } from "@/lib/authority/config";
import { can } from "@/lib/authority/roles";
import { fail, type ErrorCode } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  verb: z.enum(["addAlias", "removeAlias"]),
  email: z.string().email(),
  alias: z.string().email(),
}).strict();

const CODE: Record<AliasFailure, ErrorCode> = {
  not_found: "not_found",
  taken: "alias_taken",
  self: "alias_same_address",
  invalid: "invalid_request",
  unavailable: "write_unavailable",
};

/**
 * Admin edit of the identity alias registry: the other addresses a person
 * appears under in external systems.
 *
 * This is a clearance-granting write, not a presentation one. An alias makes a
 * session authenticated under that address resolve to the canonical person, and
 * therefore to their groups, so it lives behind `manageAccess` and lands in the
 * access history rather than beside the display-name edit it sits next to in the
 * UI.
 */
export async function POST(request: Request): Promise<Response> {
  // Flag first, before auth, for the reason the people route documents: checking
  // auth first makes a disabled route answer 401 and 403 where it would
  // otherwise answer the framework's 404, which tells an unauthenticated caller
  // that the route exists.
  if (!isAliasAdminEnabled()) return new Response(null, { status: 404 });
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

  const { verb, email, alias } = parsed.data;
  const result = await writeAlias({ verb, email, alias }, actorEmail);
  if (!result.ok) return fail(CODE[result.reason]);

  // Read the committed file back before reporting success. commitPrivateAccess
  // can refuse for reasons the caller never sees (a dirty checkout, a rejected
  // push), and an admin who just granted an address someone else's clearance is
  // owed certainty about whether it landed.
  const canonical = email.trim().toLowerCase();
  const landed = loadAliasMap()[canonical] ?? [];
  const present = landed.includes(alias.trim().toLowerCase());
  if (verb === "addAlias" ? !present : present) return fail("internal", { status: 502 });

  return Response.json({ email: canonical, aliases: landed });
}
