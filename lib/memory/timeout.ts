/**
 * Race `promise` against a `ms` wall-clock deadline.
 *
 * If `promise` settles first, its resolution or rejection propagates
 * normally. If the deadline fires first, `onTimeout` runs and the returned
 * promise resolves to `undefined` instead of waiting any further on
 * `promise` (a caller that needs to know what `promise`'s work already did
 * before the deadline must arrange that separately, e.g. by having it write
 * through a side channel as it goes, since this helper does not await
 * `promise` any further once the deadline wins).
 *
 * `onTimeout` is invoked fire-and-forget: this function does NOT await it.
 * A recovery step that itself hangs (e.g. interrupting a wedged subprocess
 * that ignores the interrupt) must never stop `withTimeout` from settling
 * within `ms` - that would defeat the entire point of a timeout. Both a
 * synchronous throw and an eventual rejection from `onTimeout` are caught
 * and swallowed so neither can produce an unhandled rejection or escape
 * this function.
 *
 * Always clears the timer on the way out, so a `promise` that settles before
 * the deadline never leaves a dangling timer alive.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void | Promise<void>,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(undefined);
    }, ms);
  });
  try {
    const result = await Promise.race([promise, deadline]);
    if (timedOut) {
      try {
        const maybePending = onTimeout();
        if (maybePending && typeof maybePending.catch === "function") {
          maybePending.catch(() => {});
        }
      } catch {
        // onTimeout threw synchronously; still must settle now, not wait on it.
      }
      return undefined;
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
