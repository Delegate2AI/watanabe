import { log } from "@/lib/log";
import { renderDocumentExports, type RenderRequest } from "./pipeline";
import { renderStoreKey } from "./store-key";

/**
 * Schedules a render instead of running one
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The assistant revises a document by calling `doc_write` again, often several
 * times while it is still working. One Chromium run per revision is waste, and
 * every intermediate one is a file nobody downloads. So a save arms a timer, a
 * later save for the same document replaces it, and only the last body is drawn.
 *
 * Fire and forget by design: `scheduleRender` returns synchronously so a save
 * never waits on a render. Nothing here can reject into a caller.
 */

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  request: RenderRequest;
}

const pending = new Map<string, Pending>();
/** In-flight renders, so a test (or a shutdown) can wait for them to settle. */
const running = new Set<Promise<void>>();
/** Waiting their turn behind the concurrency limit. */
const queue: RenderRequest[] = [];
let active = 0;

function debounceMs(): number {
  const raw = Number(process.env.DOC_RENDER_DEBOUNCE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2_000;
}

/**
 * How many renders may be in flight at once.
 *
 * There is ONE render pod and every request opens a fresh browser context, so an
 * unbounded fan-out is how it falls over: fifty documents saved in a burst
 * produced fifty simultaneous calls. Two keeps the pod busy without letting a
 * burst become an outage, and the queue means nothing is dropped, only delayed.
 */
function maxConcurrent(): number {
  const raw = Number(process.env.DOC_RENDER_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

function pump(): void {
  while (active < maxConcurrent() && queue.length > 0) {
    const request = queue.shift() as RenderRequest;
    active += 1;
    const task = renderDocumentExports(request)
      .then((outcome) => {
        if (!outcome.pdf) log.info("doc render incomplete", { docId: request.docId, version: request.version });
      })
      .catch((e: unknown) => {
        // renderDocumentExports does not throw, so reaching here means something
        // unforeseen did. It still must not become an unhandled rejection.
        log.warn("doc render failed", { docId: request.docId, err: String(e) });
      })
      .finally(() => {
        active -= 1;
        running.delete(task);
        pump();
      });
    running.add(task);
  }
}

function run(key: string, request: RenderRequest): void {
  pending.delete(key);
  // A queued render for the same document is replaced rather than duplicated:
  // it has not started, and the newer body is the one worth drawing.
  const queued = queue.findIndex((entry) => renderStoreKey(entry.ownerEmail, entry.docId) === key);
  if (queued >= 0) queue.splice(queued, 1);
  queue.push(request);
  pump();
}

/** Arm (or re-arm) the render for one document. Returns immediately. */
export function scheduleRender(request: RenderRequest): void {
  const key = renderStoreKey(request.ownerEmail, request.docId);
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => run(key, request), debounceMs());
  // Never hold the process open for a render: a pod being drained should exit.
  timer.unref?.();
  pending.set(key, { timer, request });
}

/**
 * Wait for every armed and in-flight render to settle.
 *
 * For tests and for a graceful shutdown. Loops because a render that started
 * while an earlier one was awaited would otherwise be missed.
 */
export async function flushScheduledRenders(): Promise<void> {
  for (const [key, entry] of pending) {
    clearTimeout(entry.timer);
    run(key, entry.request);
  }
  while (running.size > 0 || queue.length > 0) {
    if (running.size === 0) pump();
    await Promise.all([...running]);
  }
}
