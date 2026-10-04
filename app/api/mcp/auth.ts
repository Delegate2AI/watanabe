import { requireIdentity } from "@/lib/auth/identity";
import { isKnownMember, loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { isMcpEnabled } from "@/lib/mcp-auth/config";
import { resolveToken, touchToken } from "@/lib/mcp-auth/tokens";

/**
 * Who may reach `/api/mcp`, and with which tool set.
 *
 * Its own module because this route is the one path the SSO proxy does not
 * gate, so this is the whole boundary and it should be readable on its own.
 */

/** Who is calling. What they may do is resolved per call, never carried here. */
export interface McpCaller {
  ownerEmail: string;
  /**
   * What a bearer caller's staging worktree is keyed on, and what a stored
   * session must match to be resumable. Null for a cookie caller, who never
   * opens a worktree. Not the raw credential: a token contributes its row id,
   * so neither the token nor the email reaches a directory name.
   *
   * Non-null is also what says this credential class may hold write tools at
   * all, which is the honest residue of the `privileged` flag it replaced.
   */
  workspaceKey: string | null;
}

/** The bearer credential, or `""` for anything that is not one. */
function bearer(headers: Headers): string {
  const raw = headers.get("authorization") ?? "";
  const [scheme, ...rest] = raw.split(" ");
  return scheme.toLowerCase() === "bearer" ? rest.join(" ").trim() : "";
}

/**
 * Authenticate the request: a bearer token first, the SSO cookie second.
 *
 * One rule admits all of them. A credential is accepted only if it
 * authenticates a **known member**, tested with `isKnownMember`, which is the
 * same alias-aware membership test the rest of the app uses. Removal from
 * `access/groups.yaml` therefore kills every credential a person holds, on
 * every path, which is stronger than what came before: a token used to die on
 * role loss and nothing died on membership loss.
 *
 * There is no separate OAuth branch any more. A token this deployment's own
 * authorization server issued is a row in the same store as a portal token, so
 * `resolveToken` resolves both and the expiry clause it gained is the only
 * difference between them.
 *
 * This route is the one path the SSO proxy does not gate, so this is the whole
 * boundary. It fails closed in every direction and returns `null` in each, so
 * the caller cannot use the answer to tell a live credential from an invented
 * one: no credential, an unknown token, a revoked one, an expired one, a
 * non-member, and the flag being off are all the same refusal.
 */
export async function resolveCaller(headers: Headers): Promise<McpCaller | null> {
  if (!isMcpEnabled()) return null;
  // Read once, so a refusal and an acceptance do the same work.
  const groups = loadGroups();

  const token = bearer(headers);
  if (token) {
    const resolved = resolveToken(getDb(), token);
    if (!resolved) return null;
    if (!isKnownMember(resolved.ownerEmail, groups)) return null;
    // Only after accepting, so a refusal does the same work whichever check
    // refused it.
    touchToken(getDb(), resolved.id);
    return { ownerEmail: resolved.ownerEmail, workspaceKey: `token-${resolved.id}` };
  }

  const auth = await requireIdentity(headers);
  if ("response" in auth) return null;
  if (!isKnownMember(auth.identity.email, groups)) return null;
  return { ownerEmail: auth.identity.email, workspaceKey: null };
}

/**
 * Whether a stored session may serve this caller.
 *
 * An `Mcp-Session-Id` is guessable-adjacent state, not a credential, and it
 * carries its owner's projection. Without this check a second authenticated
 * caller presenting someone else's id would read the vault as them.
 */
export function sessionOwnerMatches(sessionOwner: string, caller: string): boolean {
  return sessionOwner.trim().toLowerCase() === caller.trim().toLowerCase();
}

/**
 * The thread whose worktree this caller stages into.
 *
 * Keyed to the CREDENTIAL for a privileged caller, so staged work survives a
 * reconnect: `kb_diff` prescribes showing the contributor the diff and waiting
 * for their confirmation before `kb_submit`, and that human pause is exactly
 * where a client drops and redials. A cookie caller never opens a worktree, so
 * theirs stays per-connection.
 */
export function workspaceThreadId(caller: McpCaller, sessionId: string): string {
  return caller.workspaceKey ? `mcp-${caller.workspaceKey}` : `mcp-${sessionId}`;
}

