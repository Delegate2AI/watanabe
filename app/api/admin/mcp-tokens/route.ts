import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { isMcpEnabled } from "@/lib/mcp-auth/config";
import { listTokens, mintToken, revokeToken } from "@/lib/mcp-auth/tokens";
import { discard } from "@/lib/repo-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const mintSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();

/**
 * Mint, list and revoke the credentials an admin's own MCP client presents
 * (spec 2026-08-21-admin-kb-mcp, D2).
 *
 * `manageAccess` only, which is the admin role, and the refusal is a 404 rather
 * than a 403 for the reason the sibling admin routes document: a 403 tells an
 * unauthorized caller the route exists. The flag is checked before auth for the
 * same reason.
 */
async function gate(request: Request): Promise<{ email: string } | Response> {
  if (!isMcpEnabled()) return new Response(null, { status: 404 });
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const email = auth.identity.email;
  if (!can(email, "manageAccess")) return new Response(null, { status: 404 });
  return { email };
}

export async function GET(request: Request): Promise<Response> {
  const gated = await gate(request);
  if (gated instanceof Response) return gated;
  return Response.json({ tokens: listTokens(getDb(), gated.email) });
}

export async function POST(request: Request): Promise<Response> {
  const gated = await gate(request);
  if (gated instanceof Response) return gated;

  const parsed = mintSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request");

  // The only response that ever carries the plaintext. Nothing logs it.
  const minted = mintToken(getDb(), { ownerEmail: gated.email, name: parsed.data.name });
  return Response.json(minted);
}

export async function DELETE(request: Request): Promise<Response> {
  const gated = await gate(request);
  if (gated instanceof Response) return gated;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return fail("invalid_request");
  // Owner-scoped, so someone else's id is indistinguishable from an unknown one.
  if (!revokeToken(getDb(), id, gated.email)) return fail("not_found");
  // The token's staging worktree is keyed on its id and outlives any single
  // connection, so revoking is the point where it stops having an owner.
  // Best-effort: the token is already gone, and nothing can reach the worktree.
  void discard(`mcp-token-${id}`).catch(() => {});
  return Response.json({ ok: true });
}
