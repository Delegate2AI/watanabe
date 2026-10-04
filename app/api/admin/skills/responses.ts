import { fail, STATUS } from "@/lib/errors/codes";
import { scrubReason } from "@/lib/skills/admin-record";
import type { SkillAdminResult } from "@/lib/skills/admin-actions";

/**
 * The failure vocabulary both skills admin routes answer with, in one place so
 * the JSON route and the zip upload route cannot drift apart on what a given
 * refusal means.
 */

/**
 * `writeSkills` and `removeInstalledSkill` report why they refused in their own
 * words. Translate to a code rather than forwarding the sentence: anything not
 * listed here is a failed commit whose text is a git message, which has no
 * business in a response body.
 */
const BAD_CHANGE = new Set([
  "invalid slug",
  "reserved slug",
  "duplicate slug",
  "invalid skill entry",
  "skill configuration failed validation",
]);

export function writeRefusal(error: string): Response {
  if (error === "forbidden") return fail("needs_role");
  if (error === "unknown skill") return fail("not_found");
  if (BAD_CHANGE.has(error)) return fail("invalid_request", { detail: "skill" });
  return fail("internal");
}

/**
 * An install refusal, carrying the pipeline's own reason.
 *
 * The reason is the only thing that tells an admin why a repository, a ref, or
 * an archive was rejected, so it is returned rather than logged away. It is
 * scrubbed of absolute paths first, and it travels in its own top-level field:
 * `fail()`'s payload takes literals only, and this is derived text.
 */
export function installRefusal(reason: string): Response {
  return Response.json(
    { error: { code: "invalid_request", detail: "install" }, reason: scrubReason(reason) },
    { status: STATUS.invalid_request },
  );
}

/**
 * The one refusal that is not routine: an update whose re-fetch renamed itself
 * onto ANOTHER installed skill, whose folder now holds the wrong content while
 * its registry row still claims the old one. It is an HTTP failure, since the
 * update did not happen, but it must not read like the benign version of the
 * same refusal. `warning` is the machine-readable half, naming the victim;
 * `reason` is the half an admin reads, and is already carried into the failure
 * banner by the admin surface.
 */
function overwroteRefusal(slug: string, victim: string): Response {
  return Response.json(
    {
      error: { code: "invalid_request", detail: "slug" },
      warning: `store_overwritten:${victim}`,
      reason: `the re-fetch of ${slug} renamed itself onto ${victim}, which is another installed skill: the folder for ${victim} now holds this content and ${victim} must be reinstalled before anyone cleared for it uses it again`,
    },
    { status: STATUS.invalid_request },
  );
}

/** The one translation of an action result, shared by both routes. */
export function actionResponse(result: SkillAdminResult): Response {
  // The success branch is already exactly the payload: `ok: true` plus whatever
  // the action has to report. `JSON.stringify` drops the undefined optionals.
  if (result.ok) return Response.json(result);
  if (result.kind === "install") return installRefusal(result.reason);
  if (result.kind === "overwrote") return overwroteRefusal(result.slug, result.victim);
  if (result.kind === "write") return writeRefusal(result.error);
  if (result.kind === "not_found") return fail("not_found");
  return fail("invalid_request", { detail: result.detail });
}
