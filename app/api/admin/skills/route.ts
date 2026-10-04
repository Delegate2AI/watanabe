import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { fail } from "@/lib/errors/codes";
import { readCappedBody } from "@/lib/http/capped-body";
import { log } from "@/lib/log";
import { runSkillAdminAction, type SkillAdminAction } from "@/lib/skills/admin-actions";
import { scrubReason, storeDirExists } from "@/lib/skills/admin-record";
import { isSkillsEnabled, MAX_SKILL_ACTION_BODY_BYTES } from "@/lib/skills/config";
import { BUILTIN_MARKETPLACE_ID } from "@/lib/skills/marketplace";
import {
  BUILTIN_MARKETPLACE_LABEL,
  marketplaceSourceIds,
  resolveMarketplaceIndex,
} from "@/lib/skills/marketplace-builtin";
import { loadSkillRegistry } from "@/lib/skills/registry";
import { actionResponse } from "./responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The admin half of spec 34: list the installed skill registry with what the
 * store actually holds, browse any configured marketplace, and apply one
 * install, update, uninstall, or clearance change.
 *
 * Admin-gated with `manageAccess`, like `/api/admin/connectors`, and dark
 * behind `SKILLS_ENABLED`. The flag is checked before the capability so that
 * flag-off answers the same 404 to an admin and a viewer alike, and the
 * capability is checked before the body, the registry, and the store, so a
 * caller who may not manage skills cannot use a response shape or a timing
 * difference to learn which slugs exist.
 */

/** Bounds only. Every value's real validation lives in the module that consumes it. */
const url = z.string().trim().min(1).max(512);
const ref = z.string().trim().min(1).max(200);
const subdir = z.string().trim().min(1).max(200);
const slug = z.string().trim().min(1).max(200);
/**
 * Shape only. The count cap, the per-key cap, and the de-duplication live in
 * `checkGroups`, which the upload route calls too, so there is exactly one cap
 * on a clearance list rather than one per route.
 */
const groups = z.array(z.string());

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("install-git"), url, ref, subdir: subdir.optional(), groups }).strict(),
  z
    .object({
      action: z.literal("install-marketplace"),
      index: url,
      name: z.string().trim().min(1).max(64),
      url,
      groups,
    })
    .strict(),
  z.object({ action: z.literal("uninstall"), slug }).strict(),
  z.object({ action: z.literal("update"), slug }).strict(),
  z.object({ action: z.literal("set-groups"), slug, groups }).strict(),
]);

export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");
  if (!can(auth.identity.email, "manageAccess")) return fail("needs_role");

  try {
    return Response.json({ entries: listEntries(), marketplaces: await marketplaces() });
  } catch (error) {
    // Every module below documents a never-throws contract, so reaching here is
    // a bug rather than a condition. It still may not surface as an unhandled
    // 500 with a stack in it.
    log.error("skills admin list failed", { err: describe(error) });
    return fail("internal");
  }
}

function listEntries(): unknown[] {
  const registry = loadSkillRegistry();
  return [
    ...registry.entries.map((entry) => ({
      ...entry,
      status: "ok" as const,
      installed: storeDirExists(entry.slug),
    })),
    // A slug the loader rejected, or a file-level parse failure as its own row.
    // Kept visible so a hand-edited entry can be seen and removed rather than
    // silently disappearing from the surface that manages it. The reason is
    // scrubbed on the same rule as an install reason: it is derived text, and
    // one uniform rule is easier to keep true than a per-source judgement.
    ...registry.errors.map((error) => ({
      slug: error.slug,
      status: "disabled" as const,
      reason: scrubReason(error.reason),
      installed: false,
    })),
  ].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Every configured index, fetched concurrently. `fetchMarketplaceIndex` owns the
 * scheme allow-list, the deadline, and the body cap, and never throws, so a
 * marketplace that is down degrades to one row carrying a reason.
 */
async function marketplaces(): Promise<unknown[]> {
  return Promise.all(
    marketplaceSourceIds().map(async (sourceId) => {
      // The built-in source resolves from a bundled document, so it costs no
      // request and cannot be the one that is slow or down.
      const index = await resolveMarketplaceIndex(sourceId);
      const label = sourceId === BUILTIN_MARKETPLACE_ID ? BUILTIN_MARKETPLACE_LABEL : sourceId;
      return index.ok
        ? { url: sourceId, label, items: index.items, errors: index.errors }
        : { url: sourceId, label, error: scrubReason(index.reason) };
    }),
  );
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isSkillsEnabled()) return fail("not_found");
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return fail("needs_role");

  const read = await readCappedBody(request, MAX_SKILL_ACTION_BODY_BYTES);
  if (!read.ok) {
    // A body that never arrived whole is the request's problem, not the
    // server's, and a dropped connection mid-post is an ordinary event. It gets
    // the same answer unparseable JSON always got.
    if (read.reason === "unreadable") return fail("invalid_request", { detail: "body" });
    return fail("invalid_request", { status: 413, detail: "size" });
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  try {
    return actionResponse(await runSkillAdminAction(parsed.data as SkillAdminAction, actorEmail));
  } catch (error) {
    // Same reasoning as GET: the install pipeline, the registry writer, and the
    // materializer all report rather than throw, so this is the backstop that
    // keeps an unexpected one from becoming a stack in a response body.
    log.error("skills admin action failed", { action: parsed.data.action, err: describe(error) });
    return fail("internal");
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}
