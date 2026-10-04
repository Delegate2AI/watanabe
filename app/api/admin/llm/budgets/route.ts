import { loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { removeBudget, saveBudget } from "@/lib/llm/admin";
import { authorizeAdmin } from "@/lib/llm/admin-route";
import { respond } from "@/lib/service/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Set a team default or a per-person override for one model group. */
export async function PUT(request: Request): Promise<Response> {
  const caller = await authorizeAdmin(request);
  if (caller instanceof Response) return caller;
  const body = await request.json().catch(() => null);
  return respond(await saveBudget({ db: getDb(), actorEmail: caller.email, groups: loadGroups() }, body));
}

/** Body `{ subjectKind, subject, groupSlug }`: back to the next rule down. */
export async function DELETE(request: Request): Promise<Response> {
  const caller = await authorizeAdmin(request);
  if (caller instanceof Response) return caller;
  const body = await request.json().catch(() => null);
  return respond(await removeBudget({ db: getDb(), actorEmail: caller.email, groups: loadGroups() }, body));
}
