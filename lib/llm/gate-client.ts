import { log } from "@/lib/log";
import { llmEnv } from "./config";
import { GATE_SECRET_HEADER } from "./internal-auth";

/** Asks the gate to pull a fresh snapshot now. Best effort and never throws: it pulls every 30s anyway. */
export async function notifyGate(): Promise<void> {
  const { gateUrl, gateSecret } = llmEnv();
  if (!gateUrl || !gateSecret) return;
  try {
    const res = await fetch(`${gateUrl.replace(/\/+$/, "")}/invalidate`, {
      method: "POST",
      headers: { [GATE_SECRET_HEADER]: gateSecret },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) log.warn("llm gate invalidate refused", { status: res.status });
  } catch (e) {
    log.warn("llm gate invalidate failed", { error: (e as Error).message });
  }
}
