import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { latestBody, addVersion, getVersions } from "@/lib/db/shared-docs";
import { getSuggestion, setSuggestionStatus } from "@/lib/db/suggestions";
import { locateInSource } from "@/lib/shared-docs/anchor";
import { accessFor, canRead, canEdit } from "@/lib/shared-docs/access";
import { requireEnabledIdentity, notFound } from "@/lib/shared-docs/authorize";
import { isDocAnnotationsEnabled } from "@/lib/shared-docs/config";
import { log } from "@/lib/log";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Accept/reject a proposed edit (spec 2026-07-22). Requires edit access: a
 * comment-only recipient can propose but not decide. Accepting locates the
 * anchor's quote in the CURRENT body (not the body at proposal time) and
 * splices it in one transaction with `addVersion`; if the quote can no longer
 * be located uniquely, the suggestion is marked `stale` with NO version
 * written, and the route returns 409 so the caller applies it by hand.
 *
 * Decisions are conditional transitions, not read-then-write: there is no
 * separate "is this still pending?" read followed by an unconditional write.
 * `setSuggestionStatus` itself only ever moves a row OUT of `pending`
 * (`WHERE status = 'pending'`), so a concurrent accept/reject racing against
 * this one can change at most one row between them. Inside the accept
 * transaction, if that conditional update loses the race (0 rows changed),
 * we throw to roll back the whole transaction -- including any version we
 * were about to append -- rather than leave an applied version dangling
 * against a suggestion some other decision already resolved.
 */

const forbidden = () => fail("needs_role", { detail: "edit" });
const Body = z.object({ action: z.enum(["accept", "reject"]) });

type Ctx = { params: Promise<{ id: string; sid: string }> };

/** Thrown inside the accept transaction to force a rollback when the
 * conditional pending -> resolved transition loses a race. Never escapes
 * this module: the outer catch below maps it to a 409. */
class SuggestionConflict extends Error {}

type AcceptOutcome = { kind: "applied"; version: number } | { kind: "stale" };

export async function PATCH(request: Request, { params }: Ctx): Promise<Response> {
  // Flag check FIRST, before identity or body parsing, so flag-off is a
  // uniform 404, never a 401 (unauthenticated) or 400 (malformed body).
  if (!isDocAnnotationsEnabled()) return notFound();
  const { id, sid } = await params;
  const gate = await requireEnabledIdentity(request);
  if ("response" in gate) return gate.response;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return fail("invalid_request", { detail: "action" });

  try {
    const db = getDb();
    const access = accessFor(db, id, gate.identity.email);
    if (!canRead(access)) return notFound();
    if (!canEdit(access)) return forbidden();
    const suggestion = getSuggestion(db, sid);
    if (!suggestion || suggestion.docId !== id) return notFound();
    const now = new Date().toISOString();
    const me = gate.identity.email;

    if (parsed.data.action === "reject") {
      const changed = setSuggestionStatus(db, sid, "rejected", me, now, null);
      if (!changed) return fail("conflict");
      return Response.json({ ok: true });
    }

    // Accept: locate in the CURRENT body and splice, atomically. The document
    // must not have moved past the version this suggestion was proposed
    // against -- checked FIRST, before ever touching locateInSource, so a
    // document that changed elsewhere (but coincidentally still contains the
    // quote) is never silently spliced against a state the proposer never
    // saw. Every setSuggestionStatus call here is conditional on the row
    // still being pending; if it loses that race, throw to roll back the
    // whole transaction (including any version we just appended).
    let outcome: AcceptOutcome;
    try {
      outcome = db.transaction((): AcceptOutcome => {
        const versions = getVersions(db, id);
        const currentVersion = versions.length > 0 ? versions[versions.length - 1].version : 1;
        if (currentVersion !== suggestion.baseVersion) {
          if (!setSuggestionStatus(db, sid, "stale", me, now, null)) throw new SuggestionConflict();
          return { kind: "stale" };
        }
        const body = latestBody(db, id) ?? "";
        const at = locateInSource(body, suggestion.anchor);
        if (!at) {
          if (!setSuggestionStatus(db, sid, "stale", me, now, null)) throw new SuggestionConflict();
          return { kind: "stale" };
        }
        const next = body.slice(0, at.start) + suggestion.proposedText + body.slice(at.end);
        const version = addVersion(db, id, me, next, { now });
        if (version === false) {
          if (!setSuggestionStatus(db, sid, "stale", me, now, null)) throw new SuggestionConflict();
          return { kind: "stale" };
        }
        if (!setSuggestionStatus(db, sid, "accepted", me, now, version)) throw new SuggestionConflict();
        return { kind: "applied", version };
      })();
    } catch (e) {
      if (e instanceof SuggestionConflict) {
        return fail("conflict");
      }
      throw e;
    }

    if (outcome.kind === "stale") {
      return fail("conflict");
    }
    return Response.json({ ok: true, version: outcome.version });
  } catch (e) {
    log.error("shared-docs request failed", { route: "PATCH /api/docs/[id]/suggestions/[sid]", status: 500, err: String(e) });
    return fail("internal");
  }
}
