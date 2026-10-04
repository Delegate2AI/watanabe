/**
 * One-shot guard for a new chat's `?q=` seed message.
 *
 * Home mints a CLIENT handle and pushes `/chat/<handle>?q=<message>`; the thread
 * sends that seed on mount and, once the stream reports the real SDK id, swaps
 * the address bar with `history.replaceState`. That swap is only cosmetic: Next
 * copies the entry's existing router tree forward, so the history entry still
 * IS the seeded page (`__PAGE__?{"q":...}`). Any back/forward traversal onto it
 * restored that page, and because the old guard was a per-mount `useRef`, the
 * seed fired again and minted a whole new thread. One message could become
 * three, and the real conversation was stranded behind an id nothing linked to.
 *
 * The fix has two independent signals, either of which is enough:
 *
 *  - the ADDRESS BAR. `replaceState` did put the real SDK id there, so a
 *    restored entry whose route id no longer matches the pathname is provably
 *    stale, and the id to resume is sitting right in the URL.
 *  - a per-tab MARKER in sessionStorage, keyed by the handle. It closes the one
 *    window the URL cannot: leaving and returning BEFORE the `session` event
 *    arrives, when the address bar still reads as the handle.
 *
 * Storage is best-effort. If sessionStorage is unavailable or throws, every
 * read degrades to "no marker", which falls back to sending: losing the user's
 * first message is a worse failure than the duplicate this guards against, and
 * the address-bar signal still covers the common case.
 */

/** Marker value written before the seed is sent, before any SDK id exists. */
export const SEED_PENDING = "pending";

const PREFIX = "chat-seed:";

/** What a mounting thread should do with its `?q=` seed. */
export type SeedDecision =
  /** Fresh handle: send the seed message. */
  | { action: "send" }
  /** This entry is stale; the live thread lives at `sessionId`. */
  | { action: "resume"; sessionId: string }
  /** The seed already fired in this tab and has not adopted an id yet. */
  | { action: "skip" };

/** The last path segment, tolerant of a trailing slash and any route prefix. */
function idFromPath(pathname: string): string | undefined {
  return pathname.split("/").filter(Boolean).pop();
}

/**
 * Pure decision, given the route's handle, the live pathname, and the stored
 * marker. Exported for tests and to keep the storage seam out of the logic.
 */
export function decideSeed(
  handle: string,
  pathname: string,
  marker: string | null,
): SeedDecision {
  // A marker that is no longer "pending" holds the adopted SDK id, the most
  // authoritative answer available: resume the real thread.
  if (marker && marker !== SEED_PENDING) return { action: "resume", sessionId: marker };

  // Otherwise the address bar decides. A pathname id that differs from the
  // route's handle means `replaceState` already swapped this entry to a real
  // thread, so the render we are in is a restored, stale copy of the seed page.
  const current = idFromPath(pathname);
  if (current && current !== handle) return { action: "resume", sessionId: current };

  if (marker === SEED_PENDING) return { action: "skip" };
  return { action: "send" };
}

/** Read this handle's marker. Never throws; unavailable storage reads as null. */
export function readSeedMarker(handle: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(PREFIX + handle) ?? null;
  } catch {
    return null;
  }
}

function write(handle: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(PREFIX + handle, value);
  } catch {
    /* best-effort: the address-bar signal still covers the restored-entry case */
  }
}

/** Record that this handle's seed has been sent, before any SDK id exists. */
export function markSeedPending(handle: string): void {
  write(handle, SEED_PENDING);
}

/** Record the SDK id this handle's thread adopted, so a stale entry can resume it. */
export function recordSeedSession(handle: string, sessionId: string): void {
  write(handle, sessionId);
}

/** `decideSeed` against the stored marker for this handle. */
export function seedDecisionFor(handle: string, pathname: string): SeedDecision {
  return decideSeed(handle, pathname, readSeedMarker(handle));
}
