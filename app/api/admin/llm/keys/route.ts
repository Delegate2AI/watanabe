import { loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { revokeAllKeys } from "@/lib/llm/admin";
import { authorizeAdmin } from "@/lib/llm/admin-route";
import { revokeLlmKeyFor } from "@/lib/llm/keys";
import { getRouterAdmin } from "@/lib/llm/router-admin";
import { respond } from "@/lib/service/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** `?id=` revokes one key of anyone; `?owner=` revokes every active key of one person (leavers). */
export async function DELETE(request: Request): Promise<Response> {
  const caller = await authorizeAdmin(request);
  if (caller instanceof Response) return caller;
  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim();
  const owner = params.get("owner")?.trim();
  const db = getDb();
  if (id) {
    const out = await revokeLlmKeyFor({ db, admin: getRouterAdmin() }, { id, ownerEmail: null });
    return respond(out, () => Response.json({ ok: true }));
  }
  if (owner) {
    return respond(await revokeAllKeys({ db, actorEmail: caller.email, groups: loadGroups(), admin: getRouterAdmin() }, owner));
  }
  return fail("invalid_request");
}
