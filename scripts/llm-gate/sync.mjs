import { randomUUID } from "node:crypto";

/**
 * Pulls the snapshot and pushes usage. A push that fails is retried with the
 * same batch id before anything newer is sent: the portal may have applied it
 * and only the answer was lost, and the id is what makes the retry harmless.
 * One pull and one push at a time; overlapping pushes could lose a batch.
 */
export function createSync({ state, portal, now = Date.now, log = console }) {
  let retry = null;
  let pulling = null;
  let pullAgain = false;
  let flushing = null;

  async function pullOnce() {
    const startedAt = now();
    const result = await portal.pullSnapshot();
    if (result.status === "ok") state.applySnapshot(result.snapshot, startedAt);
    else if (result.status === "disabled") state.markDisabled();
    else log.warn?.(`llm-gate snapshot pull failed: ${result.error}`);
  }

  /** True when there is nothing left to send. */
  async function flushOnce() {
    const batch = retry ?? state.drainBatch();
    if (!batch) return true;
    batch.batchId ??= randomUUID();
    const outcome = await portal.pushBatch(batch);
    if (outcome === "ok") {
      state.confirmBatch(batch, now());
      retry = null;
    } else if (outcome === "drop") {
      state.releaseBatch(batch);
      retry = null;
      log.warn?.(`llm-gate usage batch ${batch.batchId} refused by the portal; dropped`);
    } else {
      retry = batch;
      log.warn?.(`llm-gate usage push failed; will retry batch ${batch.batchId}`);
      return true;
    }
    return false;
  }

  return {
    /** One pull at a time; a request during a pull schedules exactly one more. */
    pull() {
      if (pulling) {
        pullAgain = true;
        return pulling;
      }
      pulling = (async () => {
        try {
          do {
            pullAgain = false;
            await pullOnce();
          } while (pullAgain);
        } finally {
          pulling = null;
        }
      })();
      return pulling;
    },

    flush() {
      flushing ??= flushOnce().finally(() => {
        flushing = null;
      });
      return flushing.then(() => undefined);
    },

    /** On shutdown: keep pushing until nothing is pending, a few attempts at most. */
    async drain(attempts = 5) {
      if (flushing) await flushing;
      for (let i = 0; i < attempts; i++) {
        const done = await flushOnce();
        if (done && !retry) return;
      }
    },
  };
}
