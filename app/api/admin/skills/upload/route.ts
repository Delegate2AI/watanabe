import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { fail } from "@/lib/errors/codes";
import { finishInstall } from "@/lib/skills/admin-actions";
import { checkGroups } from "@/lib/skills/admin-record";
import { isSkillsEnabled, maxUploadBytes } from "@/lib/skills/config";
import { installFromZip } from "@/lib/skills/install";
import { log } from "@/lib/log";
import { actionResponse } from "../responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The zip half of spec 34's install surface: `POST /api/admin/skills/upload`
 * with a multipart body carrying one `file` part and a `groups` part holding a
 * JSON array of clearance keys.
 *
 * Size is bounded here and only here. `installFromZip` receives an
 * already-materialized Buffer, and the zip reader parses a whole central
 * directory before any per-entry cap can apply, so without a ceiling at this
 * route the limit would be whatever the HTTP layer defaults to. It is checked
 * twice, the `app/api/packages` shape: a missing or non-positive
 * `Content-Length` is refused before the body is touched at all (that header is
 * the only thing standing between this route and an unbounded chunked body),
 * then the actual parsed bytes are checked, because a client can lie about the
 * header but cannot omit it.
 */

/** What a browser or a curl upload plausibly labels a zip as. */
const ZIP_CONTENT_TYPES = new Set([
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "",
]);

function isZipUpload(file: File): boolean {
  return file.name.toLowerCase().endsWith(".zip") && ZIP_CONTENT_TYPES.has(file.type.toLowerCase());
}

/** The `groups` part: a JSON array of strings, and nothing looser. */
function parseGroups(raw: FormDataEntryValue | null): string[] | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.some((group) => typeof group !== "string")) return null;
  return parsed as string[];
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return fail("needs_role");

  const limit = maxUploadBytes();
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isInteger(declared) || declared <= 0) {
    return fail("invalid_request", { status: 411, detail: "content-length" });
  }
  if (declared > limit) return fail("invalid_request", { status: 413, detail: "size" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }

  const file = form.get("file");
  if (!(file instanceof File) || !isZipUpload(file)) {
    return fail("invalid_request", { detail: "file" });
  }
  const requested = parseGroups(form.get("groups"));
  if (requested === null) return fail("invalid_request", { detail: "groups" });
  // The same cap, de-duplication, and known-key check the JSON route runs. The
  // upload route reads its groups out of a form field rather than a schema, so
  // sharing the function is the only thing that keeps the two from drifting.
  const groups = checkGroups(requested);
  if (!groups.ok) return fail("invalid_request", { detail: "groups" });

  try {
    const data = Buffer.from(await file.arrayBuffer());
    if (data.length > limit) {
      log.warn("skill upload rejected", { reason: "uploaded bytes exceed the cap", bytes: data.length });
      return fail("invalid_request", { status: 413, detail: "size" });
    }
    const installed = await installFromZip({ filename: file.name, data });
    return actionResponse(await finishInstall(installed, groups.groups, actorEmail));
  } catch (error) {
    // The extractor and the registry writer both report rather than throw, so
    // this is the backstop that keeps a truncated body or an unexpected fault
    // from becoming a stack in a response body.
    const message = error instanceof Error ? error.message : String(error);
    log.error("skill upload failed", { err: message.replace(/\s+/g, " ").trim() });
    return fail("internal");
  }
}
