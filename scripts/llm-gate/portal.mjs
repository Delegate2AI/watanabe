import { SECRET_HEADER } from "./server.mjs";

/** The portal's two internal routes (Plan A, Task 9). In-cluster only; the shared secret authorizes. */
export function createPortalClient({ portalUrl, secret, fetchImpl = fetch }) {
  const base = portalUrl.replace(/\/+$/, "");
  const headers = { [SECRET_HEADER]: secret };

  return {
    /** `disabled` is the portal's 404: the feature flag is off. */
    async pullSnapshot() {
      try {
        const res = await fetchImpl(`${base}/api/internal/llm/snapshot`, { headers, signal: AbortSignal.timeout(10_000) });
        if (res.status === 404) return { status: "disabled" };
        if (!res.ok) return { status: "error", error: `snapshot ${res.status}` };
        return { status: "ok", snapshot: await res.json() };
      } catch (e) {
        return { status: "error", error: e?.message ?? String(e) };
      }
    },

    /**
     * "ok", "retry" (network, 5xx, or a secret the portal does not accept yet),
     * or "drop": the portal refused the batch itself, and sending it again
     * would only block everything queued behind it.
     */
    async pushBatch(batch) {
      try {
        const res = await fetchImpl(`${base}/api/internal/llm/usage`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return "ok";
        return res.status === 400 || res.status === 413 || res.status === 422 ? "drop" : "retry";
      } catch {
        return "retry";
      }
    },
  };
}
