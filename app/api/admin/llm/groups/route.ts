import { loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { removeModelGroup, saveModelGroup } from "@/lib/llm/admin";
import { authorizeAdmin } from "@/lib/llm/admin-route";
import { respond } from "@/lib/service/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Create or update a model group (slug, label, patterns, default tokens and period). */
export async function PUT(request: Request): Promise<Response> {
  const caller = await authorizeAdmin(request);
  if (caller instanceof Response) return caller;
  const body = await request.json().catch(() => null);
  return respond(await saveModelGroup({ db: getDb(), actorEmail: caller.email, groups: loadGroups() }, body));
}

export async function DELETE(request: Request): Promise<Response> {
  const caller = await authorizeAdmin(request);
  if (caller instanceof Response) return caller;
  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug) return fail("invalid_request");
  return respond(await removeModelGroup({ db: getDb(), actorEmail: caller.email, groups: loadGroups() }, slug));
}
