import { getDb } from "@/lib/db/client";
import { isThreadDirty, markDreamed } from "@/lib/db/threads";
import { log } from "@/lib/log";
import { isMemoryEnabled } from "./config";
import { runDream } from "./dream";
import { readTranscriptText } from "./transcript";

/**
 * Fire-and-forget consolidation of one thread into memory. Reads the
 * transcript, dreams, and clears the dirty flag on success. Callers (see
 * `lib/agent/session.ts`'s `dispose()` and the next-session backstop in
 * `register()`) must NOT await this: it returns immediately, and the actual
 * work runs detached so a slow/failed dream never blocks a turn or an
 * eviction. Errors are swallowed and the dirty flag is left set so the next
 * session's backstop retries.
 */
export function consolidateThread(input: {
  sdkSessionId: string;
  ownerEmail: string;
  ownerName?: string;
  /**
   * The owner's resolved clearance, threaded through to the dream so its
   * shared-memory writes are group-scoped (spec 32). Omitted means no shared
   * write access, not unrestricted.
   */
  clearance?: string[];
}): void {
  if (!isMemoryEnabled()) return;
  void (async () => {
    try {
      // Only dream threads with un-consolidated turns. A read-only reopen of an
      // already-dreamed thread that later idles or gets evicted must not trigger
      // a full (and billed) dream pass over its unchanged transcript. This gate
      // protects every caller (dispose, the register backstop) in one place.
      if (!isThreadDirty(getDb(), input.sdkSessionId)) return;
      const transcript = await readTranscriptText(input.sdkSessionId);
      const result = await runDream({
        sdkSessionId: input.sdkSessionId,
        ownerEmail: input.ownerEmail,
        ownerName: input.ownerName,
        transcript,
        clearance: input.clearance,
      });
      if (result === "committed" || result === "nothing") markDreamed(getDb(), input.sdkSessionId);
    } catch (err) {
      log.warn("consolidate failed; leaving thread dirty for backstop", {
        sdkSessionId: input.sdkSessionId,
        err: String(err),
      });
    }
  })();
}
