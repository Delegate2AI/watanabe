import { requireIdentity } from "@/lib/auth/identity";
import { isKnownMember, loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { isMcpEnabled } from "@/lib/mcp-auth/config";
import { listTokens, revokeToken } from "@/lib/mcp-auth/tokens";
import { discard } from "@/lib/repo-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A person's own MCP grants (spec 2026-09-05, D7).
 *
 * Distinct from `/api/admin/mcp-tokens`, which mints and is admin-only. This
 * one neither mints nor needs a capability: `listTokens` and `revokeToken` are
 * already owner-scoped, so the identity IS the authorization and somebody
 * else's token id is indistinguishable from an invented one.
 */
async function gate(request: Request): Promise<{ email: string } | Response> {
  if (!isMcpEnabled()) return new Response(null, { status: 404 });
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  // The same membership rule the endpoint itself applies.
  if (!isKnownMember(auth.identity.email, loadGroups())) return new Response(null, { status: 404 });
  return { email: auth.identity.email };
}

export async function GET(request: Request): Promise<Response> {
  const gated = await gate(request);
  if (gated instanceof Response) return gated;
  return Response.json({ tokens: listTokens(getDb(), gated.email) });
}

export async function DELETE(request: Request): Promise<Response> {
  const gated = await gate(request);
  if (gated instanceof Response) return gated;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return fail("invalid_request");
  if (!revokeToken(getDb(), id, gated.email)) return fail("not_found");
  // The token's staging worktree is keyed on its id and outlives any single
  // connection, so revoking is where it stops having an owner. Best effort:
  // the token is already gone and nothing can reach the worktree.
  void discard(`mcp-token-${id}`).catch(() => {});
  return Response.json({ ok: true });
}
