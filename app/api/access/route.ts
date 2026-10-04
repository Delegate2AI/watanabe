import { z } from "zod";
import { evictAllWarmSessions } from "@/lib/agent/session-evict-all";
import { writeAccess, type AccessChange } from "@/lib/authority/access";
import { can } from "@/lib/authority/roles";
import { requireIdentity } from "@/lib/auth/identity";
import { FLAG_NAMES } from "@/lib/config/flag-registry";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A group name becomes a YAML map key; constrain it to a safe slug so a crafted
// name cannot widen the written key surface. The slug regex alone still admits
// "constructor" (all lowercase), which resolves on Object.prototype and would
// throw when indexed, so also reject the reserved prototype keys explicitly.
// Emails are validated here too.
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const groupName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .refine((name) => !RESERVED_KEYS.has(name), { message: "reserved group name" });
const emailField = z.string().email();
const changeSchema = z.discriminatedUnion("verb", [
  z.object({ verb: z.literal("addToGroup"), group: groupName, email: emailField }).strict(),
  z.object({ verb: z.literal("removeFromGroup"), group: groupName, email: emailField }).strict(),
  z.object({ verb: z.literal("createGroup"), group: groupName }).strict(),
  z.object({ verb: z.literal("deleteGroup"), group: groupName }).strict(),
  z.object({
    verb: z.literal("setRole"),
    email: emailField,
    role: z.enum(["viewer", "editor", "approver", "admin"]),
  }).strict(),
  z.object({
    verb: z.literal("setFlag"),
    name: z.string().refine((name) => FLAG_NAMES.has(name), { message: "unknown flag" }),
    value: z.boolean(),
  }).strict(),
]);

/**
 * `writeAccess` reports why it refused in its own vocabulary. Translate that to
 * a code rather than forwarding the sentence: the writer's wording is internal,
 * and a commit failure can carry a git message that has no business in a body.
 */
const BAD_CHANGE = new Set([
  "unknown flag",
  "group is required",
  "valid email is required",
  "at least one admin is required",
  "access configuration failed validation",
]);

function refusal(reason: string | undefined): Response {
  if (reason === "forbidden") return fail("needs_role");
  if (reason === "feature disabled") return fail("not_found");
  if (reason !== undefined && BAD_CHANGE.has(reason)) return fail("invalid_request", { detail: "change" });
  // Anything else is a failed commit, whose reason is a git message. It is
  // logged by the writer and never travels in a body.
  return fail("internal");
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  const actorEmail = auth.identity.email;
  if (!can(actorEmail, "manageAccess")) return fail("needs_role");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) {
    return fail("invalid_request", { detail: "body" });
  }

  const result = await writeAccess(parsed.data as AccessChange, actorEmail);
  if (!result.ok) return refusal(result.error);
  // Every verb here can change what a live session may do, and a session
  // snapshots the answer in its constructor: `clearanceSet` (which drives the
  // vault root, connector grants and the materialized skills plugin) and the
  // feature flags are both resolved once, at construction. So a group removal
  // left a warm session reading a vault root it no longer had, and turning
  // CONNECTORS_ENABLED on left an open thread with no picker and nothing on
  // screen explaining why. Evicting makes the next turn rebuild with the value
  // that was just written. Deferred per session when one is mid-turn, so an
  // answer in flight is never interrupted.
  evictAllWarmSessions();
  return Response.json({ version: result.version, warnings: result.warnings ?? [] });
}
