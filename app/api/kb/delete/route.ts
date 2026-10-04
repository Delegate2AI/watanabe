import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { isAdmin, loadGroups } from "@/lib/authority/groups";
import { fail } from "@/lib/errors/codes";
import { proposeNoteDeletion, type DeleteNoteResult } from "@/lib/kb-write/delete-note";
import { isKbDeleteEnabled } from "@/lib/review/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ path: z.string().min(1) }).strict();

/**
 * A path outside the vault answers exactly as a path that is not there: the
 * delete endpoint is not an oracle for what exists beyond `docs/`.
 */
function refusal(result: Extract<DeleteNoteResult, { ok: false }>): Response {
  if (result.reason === "not_found" || result.reason === "forbidden") return fail("not_found");
  if (result.reason === "write_unavailable") return fail("write_unavailable");
  if (result.reason === "conflict") return fail("conflict");
  return fail("internal");
}

export async function POST(request: Request): Promise<Response> {
  if (!isKbDeleteEnabled()) return fail("not_found");
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  // Admin, not `approve`: approving someone else's proposal is not the same
  // authority as proposing a note's removal.
  if (!isAdmin(auth.identity.email, loadGroups())) return fail("needs_role");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "path" });

  const result = await proposeNoteDeletion({
    relPath: parsed.data.path,
    actorEmail: auth.identity.email,
    actorName: auth.identity.name ?? auth.identity.email,
  });
  if (!result.ok) return refusal(result);
  return Response.json({ branch: result.branch, mrUrl: result.mrUrl });
}
