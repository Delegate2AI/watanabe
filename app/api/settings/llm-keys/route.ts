import { getDb } from "@/lib/db/client";
import { listLlmKeys } from "@/lib/db/llm-keys";
import { fail } from "@/lib/errors/codes";
import { authorizeMember } from "@/lib/llm/admin-route";
import { createLlmKey, revokeLlmKeyFor } from "@/lib/llm/keys";
import { getRouterAdmin } from "@/lib/llm/router-admin";
import { respond } from "@/lib/service/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A person's own LLM keys (spec 2026-10-03). Every call is owner-scoped, so the
// identity is the authorization, the same shape as `/api/settings/mcp-tokens`.

export async function GET(request: Request): Promise<Response> {
  const caller = await authorizeMember(request);
  if (caller instanceof Response) return caller;
  return Response.json({ keys: listLlmKeys(getDb(), caller.email) });
}

export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeMember(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
  if (typeof body?.label !== "string") return fail("invalid_request");
  const out = await createLlmKey({ db: getDb(), admin: getRouterAdmin() }, { ownerEmail: caller.email, label: body.label });
  return respond(out, (value) => Response.json(value, { status: 201 }));
}

export async function DELETE(request: Request): Promise<Response> {
  const caller = await authorizeMember(request);
  if (caller instanceof Response) return caller;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return fail("invalid_request");
  const out = await revokeLlmKeyFor({ db: getDb(), admin: getRouterAdmin() }, { id, ownerEmail: caller.email });
  return respond(out, () => Response.json({ ok: true }));
}
