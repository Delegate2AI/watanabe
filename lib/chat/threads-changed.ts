/**
 * A one-event client signal: "this owner's thread list just changed".
 *
 * The sidebar's Pinned + Recents groups are seeded by the shell layout's server
 * render and otherwise only re-read on a `router.refresh()`. A brand-new chat
 * never triggers either: Home pushes to `/chat/<handle>` BEFORE the thread
 * exists, and the row is only created later, when the stream reports its SDK id.
 * At that moment the thread deliberately swaps the URL with
 * `history.replaceState` rather than navigating, so the live stream is not torn
 * down, which also means nothing re-renders the layout. The new chat stayed
 * invisible in the sidebar until the user reloaded the page.
 *
 * A `router.refresh()` would re-render the whole route to fix a list the
 * sidebar can already refetch on its own (`GET /api/threads`), so this is just
 * the nudge to do that: no server round-trip for the rest of the page, and
 * nothing that can disturb the in-flight turn.
 *
 * Both halves are no-ops without a DOM, so server rendering and node-environment
 * tests can call them freely.
 */

/** Event name on `window`. Namespaced so it cannot collide with a library's. */
export const THREADS_CHANGED = "watanabe:threads-changed";

/** Tell any mounted thread list to refetch. Safe to call anywhere. */
export function announceThreadsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(THREADS_CHANGED));
}

/** Subscribe to {@link THREADS_CHANGED}. Returns the unsubscribe function. */
export function onThreadsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(THREADS_CHANGED, handler);
  return () => window.removeEventListener(THREADS_CHANGED, handler);
}
