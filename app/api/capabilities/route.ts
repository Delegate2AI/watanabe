import { requireIdentity } from "@/lib/auth/identity";
import { isKbWriteEnabled } from "@/lib/authority/write-gate";
import { isDictationEnabled } from "@/lib/dictate/config";
import { isContentConfigured } from "@/lib/content/config";
import { log } from "@/lib/log";
import type { Capabilities } from "@/lib/ui/capabilities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/capabilities → what this deployment can actually do.
 *
 * A precondition, not an error. "No write access to the knowledge base" used to
 * be discovered on click, as a 500 whose body named an environment variable. It
 * is a fact about the deployment that is knowable before render, so the client
 * asks once and disables the controls that cannot work, with a reason.
 *
 * Booleans only. The response never carries a token, a token prefix, an
 * environment variable name, or a configuration value: a capability probe that
 * echoed any of those would be a worse leak than the error it replaces. Identity
 * is required so this is not an open probe of the deployment's configuration.
 *
 * Never throws: a gate that blows up (an unreadable flags file, a malformed
 * backend URL) reports the capability as unavailable rather than 500ing, and the
 * exception text stays in the log, never in the body.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;

  const capabilities: Capabilities = {
    kbWrite: safely("kbWrite", kbWriteAvailable),
    dictation: safely("dictation", isDictationEnabled),
    shortFormContent: safely("shortFormContent", isContentConfigured),
  };
  return Response.json(capabilities);
}

/**
 * Whether a knowledge-base write can succeed right now: the flag is on AND a
 * write credential is configured. Both halves matter, and neither is reported
 * separately: the user-facing fact is one bit, "can this deployment publish".
 */
function kbWriteAvailable(): boolean {
  const token = process.env.REPO_WRITE_TOKEN?.trim();
  return isKbWriteEnabled() && token !== undefined && token.length > 0;
}

/** Resolve one capability, reporting `false` (and logging) if its gate throws. */
function safely(name: string, resolve: () => boolean): boolean {
  try {
    return resolve();
  } catch (error) {
    log.warn("capability check failed", {
      route: "GET /api/capabilities",
      capability: name,
      err: String(error),
    });
    return false;
  }
}
