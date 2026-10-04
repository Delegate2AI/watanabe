import { loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { listBudgetRequests } from "@/lib/db/llm-requests";
import { authorizeMember } from "@/lib/llm/admin-route";
import { requestMoreTokens } from "@/lib/llm/requests";
import { respond } from "@/lib/service/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The signed-in person's own budget requests. */
export async function GET(request: Request): Promise<Response> {
  const caller = await authorizeMember(request);
  if (caller instanceof Response) return caller;
  return Response.json({ requests: listBudgetRequests(getDb(), { requesterEmail: caller.email }) });
}

/** Ask for more tokens in one model group; admins get a task. */
export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeMember(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => null)) as { groupSlug?: unknown; tokens?: unknown; reason?: unknown } | null;
  const out = requestMoreTokens(
    { db: getDb(), groups: loadGroups() },
    { requesterEmail: caller.email, groupSlug: String(body?.groupSlug ?? ""), tokens: body?.tokens, reason: body?.reason },
  );
  return respond(out, (value) => Response.json({ request: value }, { status: 201 }));
}
