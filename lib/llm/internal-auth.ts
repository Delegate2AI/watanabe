import { constantTimeEquals } from "@/lib/auth/identity";
import { log } from "@/lib/log";
import { llmEnv } from "./config";

export const GATE_SECRET_HEADER = "x-llm-gate-secret";

/**
 * Null when the caller is the gate; otherwise the response to return. Fails
 * closed: with no secret configured nothing is accepted, the same shape as the
 * repo refresh webhook.
 */
export function checkGateSecret(request: Request): Response | null {
  const secret = llmEnv().gateSecret;
  if (!secret) {
    log.warn("llm internal route called but LLM_GATE_SECRET is unset");
    return new Response(null, { status: 501 });
  }
  const provided = request.headers.get(GATE_SECRET_HEADER);
  if (!provided || !constantTimeEquals(provided, secret)) return new Response(null, { status: 401 });
  return null;
}
