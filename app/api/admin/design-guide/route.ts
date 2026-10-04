import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { DEFAULT_DESIGN_HOUSE_STYLE } from "@/lib/agent/design-house-style";
import { composeDesignPrompt, DESIGN_CONSTRAINTS } from "@/lib/agent/design-prompt";
import { MAX_DESIGN_GUIDE_BYTES } from "@/lib/design-guide/config";
import { loadDesignGuide } from "@/lib/design-guide/store";
import { writeDesignGuide } from "@/lib/design-guide/write";
import { isHtmlDocumentsEnabled } from "@/lib/documents/config";
import { fail } from "@/lib/errors/codes";
import { readCappedBody } from "@/lib/http/capped-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read and replace the admin-editable half of the document design guidance
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Admin-gated with `manageAccess`, exactly like `/api/admin/connectors`, and
 * dark behind `HTML_DOCUMENTS_ENABLED` rather than a flag of its own: a guide
 * for a format the assistant cannot write is nothing to edit. The flag is
 * checked before the capability so flag-off answers the same 404 to an admin and
 * a viewer alike.
 *
 * GET returns the assembled prompt as well as the guide, because otherwise an
 * admin is editing one half of a text they cannot see. The constraints half is
 * read-only everywhere: it is a code constant and there is no route that writes
 * it.
 */

/**
 * Twice the stored ceiling. The real limit is `checkDesignGuide`, which reports
 * the byte count it refused; this only bounds what is buffered, so an oversized
 * paste still gets the explanation rather than a bare 413.
 */
const MAX_GUIDE_BODY_BYTES = MAX_DESIGN_GUIDE_BYTES * 2;

const saveSchema = z.object({ text: z.string() }).strict();

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isHtmlDocumentsEnabled()) return fail("not_found");
  if (!can(auth.identity.email, "manageAccess")) return fail("needs_role");

  const guide = loadDesignGuide();
  return Response.json({
    guide,
    builtIn: DEFAULT_DESIGN_HOUSE_STYLE,
    constraints: DESIGN_CONSTRAINTS,
    assembled: composeDesignPrompt(guide.text),
    maxBytes: MAX_DESIGN_GUIDE_BYTES,
  });
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isHtmlDocumentsEnabled()) return fail("not_found");
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return fail("needs_role");

  const read = await readCappedBody(request, MAX_GUIDE_BODY_BYTES);
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
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  const result = await writeDesignGuide(parsed.data.text, actorEmail);
  if (result.ok) return Response.json({ ok: true });
  if (result.error === "forbidden") return fail("needs_role");
  if (result.problems) {
    // The standard failure shape, plus the lines that caused it. A refusal an
    // admin cannot locate in a 3kB text area is a refusal they will retype
    // their whole guide to escape.
    return Response.json(
      { error: { code: "invalid_request", detail: "guide" }, problems: result.problems },
      { status: 400 },
    );
  }
  // Anything left is a failed commit, whose text is a git message.
  return fail("write_unavailable");
}
