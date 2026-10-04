import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { MAX_DESIGN_GUIDE_BYTES } from "@/lib/design-guide/config";
import { previewDesignGuide } from "@/lib/design-guide/preview";
import { checkDesignGuide } from "@/lib/design-guide/validate";
import { isHtmlDocumentsEnabled } from "@/lib/documents/config";
import { fail } from "@/lib/errors/codes";
import { readCappedBody } from "@/lib/http/capped-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Try it": write the sample document against a guide that has not been saved.
 *
 * Its own route rather than another verb on the sibling, because it is a
 * different kind of thing: the sibling commits to a git ref, this one spends a
 * model call and stores nothing.
 *
 * The candidate is validated with the same checker the save path uses, so an
 * admin cannot preview guidance they would not be allowed to keep, and a run
 * that was going to contradict the constraints costs nothing.
 */

const MAX_PREVIEW_BODY_BYTES = MAX_DESIGN_GUIDE_BYTES * 2;

const previewSchema = z.object({ text: z.string() }).strict();

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isHtmlDocumentsEnabled()) return fail("not_found");
  if (!can(auth.identity.email, "manageAccess")) return fail("needs_role");

  const read = await readCappedBody(request, MAX_PREVIEW_BODY_BYTES);
  if (!read.ok) {
    if (read.reason === "unreadable") return fail("invalid_request", { detail: "body" });
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  const checked = checkDesignGuide(parsed.data.text);
  if (!checked.ok) {
    return Response.json(
      { error: { code: "invalid_request", detail: "guide" }, problems: checked.problems },
      { status: 400 },
    );
  }

  const result = await previewDesignGuide(parsed.data.text);
  // Too many already running is the caller's rate, not a fault anywhere: 429,
  // and it clears on its own.
  if (!result.ok && result.error === "busy") return fail("internal", { status: 429, message: "busy" });
  // A timeout or a model failure is an outcome to report in the panel, not a
  // fault in the request: 502, like the review path's upstream call.
  if (!result.ok) return fail("internal", { status: 502, message: result.error });
  return Response.json({ html: result.html });
}
