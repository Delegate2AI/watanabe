import { loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { authorizeAdmin } from "@/lib/llm/admin-route";
import { decideRequest } from "@/lib/llm/requests";
import { respond } from "@/lib/service/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Body `{ id, action: approve_permanent | approve_top_up | reject, tokens?, note? }`. */
export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeAdmin(request);
  if (caller instanceof Response) return caller;
  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; action?: unknown; tokens?: unknown; note?: unknown }
    | null;
  if (typeof body?.id !== "string" || !body.id) return fail("invalid_request");
  const out = await decideRequest(
    { db: getDb(), groups: loadGroups() },
    { id: body.id, actorEmail: caller.email, action: body.action, tokens: body.tokens, note: body.note },
  );
  return respond(out, (value) => Response.json({ request: value }));
}
