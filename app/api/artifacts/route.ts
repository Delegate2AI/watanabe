import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { insertArtifact, listArtifactsForOwner, updateArtifact } from "@/lib/db/artifacts";
import { isOwnedBy } from "@/lib/db/ownership";
import { isArtifactsEnabled, isKbProposeEditEnabled } from "@/lib/artifacts/config";
import { effectiveCanWrite } from "@/lib/authority/write-gate";
import { readSourceNote } from "@/lib/kb/source-note";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TITLE = 120;

/**
 * Two ways in, and the difference matters.
 *
 * `body` is the chat capture: the caller authored the content, so they send it.
 *
 * `sourcePath` is "Propose an edit" on a KB note, where the caller must NOT send
 * the content. What their page rendered came from their clearance projection,
 * and building a projection rewrites files on disk, deleting any link whose
 * target is absent from their view. Accepting that body would publish those
 * deletions back over the canonical note as if the author had made them. So the
 * server reads the source itself (`lib/kb/source-note.ts`) and the request
 * carries only which note is meant.
 */
const CreateBody = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE).optional(),
    body: z.string().min(1).optional(),
    sourcePath: z.string().trim().min(1).max(1024).optional(),
    sourceThreadId: z.string().min(1).optional(),
    targetPath: z.string().trim().min(1).max(1024).optional(),
    targetVisibility: z.array(z.string().trim().min(1)).min(1).optional(),
  })
  .refine((v) => (v.body === undefined) !== (v.sourcePath === undefined), {
    message: "exactly one of body or sourcePath is required",
  });

/**
 * A title is read by a person in a list, so it carries no markup. "Save as
 * artifact" sends no title and the first line of an answer is prose rather than
 * a heading, so it arrives with inline markdown that used to be stored as
 * written: the grid showed `The glossary defines **Depth** as:`, asterisks and
 * all. Only inline forms are unwrapped, never removed, so the words survive.
 */
function plainText(line: string): string {
  return line
    .replace(/^\s*[#>]+\s*/, "") // heading or quote marker
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "") // list marker
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // link or image: keep the text
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2") // bold italic
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(\*|_)(.+?)\1/g, "$2") // italic
    .replace(/`([^`]*)`/g, "$1") // code span
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/\s+/g, " ")
    .replace(/[\s:;,.\-*_]+$/, "") // trailing punctuation, e.g. a lead-in colon
    .trim();
}

/**
 * Cut a derived title to a title-like length on a word boundary.
 *
 * `MAX_TITLE` (120) is the storage bound, not a readable one: a whole prose
 * sentence fits inside it, so the old cut produced grid entries like "The short
 * version, grounded in 00-overview/executive-summary.md and 00-overview/gl" and
 * a matching slug for the KB path. Cutting mid-word is what made those look
 * broken rather than merely long.
 */
function shorten(line: string, max = 72): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s:;,.\-*_]+$/, "");
}

/**
 * A bounded title: an explicit one, else the body's own heading, else its first
 * line, else a default.
 *
 * The heading is preferred because "Save as artifact" sends no title and an
 * assistant answer that HAS a heading has already named itself. Only when there
 * is no heading do we fall back to the opening line, which is prose and so gets
 * shortened to something that reads as a title in a grid and slugifies into a
 * sane KB filename.
 */
function deriveTitle(title: string | undefined, body: string): string {
  const explicit = title?.trim();
  if (explicit) return explicit;
  const lines = body.split(/\r?\n/);
  const heading = lines.find((line) => /^\s*#{1,6}\s+\S/.test(line));
  if (heading) {
    const text = plainText(heading);
    if (text) return shorten(text, MAX_TITLE);
  }
  const firstLine = lines.map(plainText).find((line) => line.length > 0) ?? "";
  if (!firstLine) return "Untitled artifact";
  return shorten(firstLine);
}

/**
 * POST /api/artifacts -> capture a chat document as a draft artifact (spec 27).
 *
 * Owner-scoped: the new artifact belongs to the caller. Flag-gated by
 * `ARTIFACTS_ENABLED`; off, this route is a 404 empty surface so no artifact
 * can be created and the flag-off byte-path is unchanged.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;

  if (!isArtifactsEnabled()) {
    return fail("not_found");
  }

  let parsed: z.infer<typeof CreateBody>;
  try {
    parsed = CreateBody.parse(await request.json());
  } catch {
    return fail("invalid_request");
  }

  // Resolved server-side for a `sourcePath` request: the body, the title, and
  // the target all come off the source note, never off the request.
  let seed: { title: string | undefined; body: string; targetPath?: string; targetVisibility?: string[] };
  if (parsed.sourcePath !== undefined) {
    if (!isKbProposeEditEnabled() || !effectiveCanWrite(identity.email)) {
      return fail("not_found");
    }
    // Null covers "no such note" and "you are not cleared for it" alike, and
    // both answer 404: the KB view's no-oracle rule does not stop being true
    // because the caller reached it through this route instead.
    // `requireIdentity` deliberately carries no clearance (it authenticates, it
    // does not authorize), so it is resolved here from the one resolver every
    // KB surface uses. Passing an empty list instead would silently narrow the
    // projection to all-hands and 404 every restricted note the caller can
    // legitimately see.
    const source = readSourceNote(parsed.sourcePath, resolveClearanceForEmail(identity.email));
    if (!source) return fail("not_found");
    seed = {
      title: parsed.title ?? source.title,
      body: source.body,
      targetPath: source.relPath,
      targetVisibility: source.visibility,
    };
  } else {
    if (parsed.body === undefined || parsed.body.trim() === "") {
      return fail("invalid_request");
    }
    seed = {
      title: parsed.title,
      body: parsed.body,
      targetPath: parsed.targetPath,
      targetVisibility: parsed.targetVisibility,
    };
  }

  // A captured artifact may name the chat it came from. The caller must OWN
  // that thread, else they could stamp another user's thread id onto their
  // artifact (a cross-user link). A foreign or unknown thread id both fail
  // `isOwnedBy` and return the same 404 as elsewhere (no existence oracle).
  if (parsed.sourceThreadId && !isOwnedBy(getDb(), parsed.sourceThreadId, identity.email)) {
    return fail("not_found");
  }

  try {
    const id = randomUUID();
    const db = getDb();
    db.transaction(() => {
      insertArtifact(db, {
        id,
        title: deriveTitle(seed.title, seed.body),
        ownerEmail: identity.email,
        sourceThreadId: parsed.sourceThreadId ?? null,
        body: seed.body,
      });
      if (seed.targetPath || seed.targetVisibility) {
        updateArtifact(db, id, identity.email, {
          targetPath: seed.targetPath,
          targetVisibility: seed.targetVisibility,
        });
      }
    })();
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    log.error("artifacts request failed", {
      route: "POST /api/artifacts",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}

/**
 * GET /api/artifacts -> the caller's artifacts for the surface grid.
 *
 * Identity-scoped: `listArtifactsForOwner` filters to the requester's own
 * email, so one user's list can never surface another's. Flag-off returns an
 * empty list (the surface renders its empty state).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const { identity } = auth;

  if (!isArtifactsEnabled()) return Response.json({ artifacts: [] });

  try {
    const artifacts = listArtifactsForOwner(getDb(), identity.email).map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      sourceThreadId: a.sourceThreadId,
      updatedAt: a.updatedAt,
    }));
    return Response.json({ artifacts });
  } catch (e) {
    log.error("artifacts request failed", {
      route: "GET /api/artifacts",
      status: 500,
      owner: identity.email,
      err: String(e),
    });
    return fail("internal");
  }
}
