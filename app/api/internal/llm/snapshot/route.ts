import { loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { isLlmKeysEnabled } from "@/lib/llm/config";
import { checkGateSecret } from "@/lib/llm/internal-auth";
import { buildSnapshot } from "@/lib/llm/snapshot";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pulled by llm-gate every 30 seconds and on invalidate. In-cluster only; the secret is the authorization. */
export async function GET(request: Request): Promise<Response> {
  if (!isLlmKeysEnabled()) return new Response(null, { status: 404 });
  const denied = checkGateSecret(request);
  if (denied) return denied;
  try {
    return Response.json(buildSnapshot(getDb(), loadGroups()));
  } catch (e) {
    log.error("llm snapshot failed", { error: (e as Error).message });
    return fail("internal");
  }
}
