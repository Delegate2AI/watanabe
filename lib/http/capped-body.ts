import { log } from "@/lib/log";

/**
 * A JSON request body, or why it could not be had.
 *
 * An App Router handler has no default body limit, so `request.json()` buffers
 * whatever arrives. The declared length is checked first when there is one, but
 * it is only a claim and a chunked request carries none, so the stream is read a
 * chunk at a time and abandoned the moment the cap is passed. That is what
 * bounds the memory rather than the header.
 *
 * The read itself is wrapped, the way `lib/skills/marketplace-http.ts` wraps its
 * own capped read. A stream that errors mid-read is an ordinary event (a dropped
 * connection during a post), and it happens BEFORE a handler's own backstop is
 * entered, so leaving it unwrapped would let it escape into the framework
 * carrying whatever text the transport put in the error.
 *
 * Shared by the skills and connectors admin routes so neither can be the one
 * that buffers an unbounded body.
 */
export type CappedBody = { ok: true; text: string } | { ok: false; reason: "too_large" | "unreadable" };

export async function readCappedBody(request: Request, limit: number): Promise<CappedBody> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return { ok: false, reason: "too_large" };

  const body = request.body;
  if (body === null) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    log.warn("admin request body could not be read", { err: text.replace(/\s+/g, " ").trim() });
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}
