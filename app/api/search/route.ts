import { requireIdentity } from "@/lib/auth/identity";
import { loadGroups, resolveClearance } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { globalSearch } from "@/lib/search/global";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/search?q= -> global search across chats, KB, artifacts, shared docs,
 * meetings, and tasks, each scoped to the caller (spec 25/26/27/28). Every
 * source is authorized by ownership or clearance in `globalSearch`, so results
 * never include anything the caller could not otherwise open. Flag-off sources
 * are absent. An empty/blank query returns no groups.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;

  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.trim() === "") return Response.json({ groups: [] });

  try {
    const email = auth.identity.email;
    const clearance = resolveClearance(email, loadGroups());
    const groups = await globalSearch(query, { db: getDb(), email, clearance });
    return Response.json({ groups });
  } catch (error) {
    log.error("search request failed", { route: "GET /api/search", error: String(error) });
    return fail("internal");
  }
}
