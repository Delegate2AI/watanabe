import { requireIdentity } from "@/lib/auth/identity";
import { aliasIndex, canonicalEmail } from "@/lib/authority/aliases";
import { isKnownMember, loadGroups } from "@/lib/authority/groups";
import { can } from "@/lib/authority/roles";
import { isLlmKeysEnabled } from "./config";

/**
 * The gate for every `/api/admin/llm/*` route: flag off, not signed in, or not
 * a manageAccess holder all look like a route that does not exist, the same as
 * `/api/admin/mcp-tokens`.
 */
export async function authorizeAdmin(request: Request): Promise<{ email: string } | Response> {
  if (!isLlmKeysEnabled()) return new Response(null, { status: 404 });
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!can(auth.identity.email, "manageAccess")) return new Response(null, { status: 404 });
  return { email: canonicalEmail(auth.identity.email, aliasIndex()) };
}

/** The gate for the signed-in user's own `/api/settings/llm*` routes. */
export async function authorizeMember(request: Request): Promise<{ email: string } | Response> {
  if (!isLlmKeysEnabled()) return new Response(null, { status: 404 });
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isKnownMember(auth.identity.email, loadGroups())) return new Response(null, { status: 404 });
  return { email: canonicalEmail(auth.identity.email, aliasIndex()) };
}
