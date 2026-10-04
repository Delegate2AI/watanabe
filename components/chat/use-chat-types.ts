/** Where a turn currently stands: nothing running, or the agent is streaming. */
export type ChatStatus = "idle" | "streaming";

/** How often the reconnect path re-requests the transcript while a run is active. */
export const RECONNECT_POLL_MS = 1500;
/** Cap on reconnect polls so a stuck "active" flag can never poll forever. */
export const MAX_RECONNECT_POLLS = 60;

let seq = 0;
/** A stable-enough client id for optimistic turns (no crypto dependency in jsdom). */
export function localId(): string {
  seq += 1;
  return `local-${Date.now()}-${seq}`;
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface UseChatOptions {
  /**
   * True when this is a brand-new thread minted on Home (the route id is a
   * client handle, not a resumable SDK session). A new thread does NOT hydrate
   * and its first send starts fresh. False (the default) means resume: the
   * server already ownership-checked the id, so it is treated as the live SDK
   * session id from the start.
   */
  isNew?: boolean;
  /** Called with the real SDK session id once the stream reports it. */
  onSession?: (sessionId: string) => void;
  /**
   * Spec 29: when the canvas is enabled, hydrate this thread's chat documents on
   * resume so their cards reappear even if the transcript's old tool results were
   * compacted away. Off (the default), no hydration request is made, so the
   * flag-off byte-path (including the network) is unchanged.
   */
  canvasEnabled?: boolean;
  /**
   * Doc-copilot binding (spec 2026-08-27): the shared doc every send of this
   * hook works on. Included in the POST body; the route flag- and ACL-checks
   * it. Absent (the default) keeps the wire byte-identical.
   */
  docId?: string;
  preMinted?: boolean;
  pendingConnectors?: readonly string[];
  modelChoice?: { model?: string; effort?: string };
}

/** A hydrated chat-document summary (spec 29 resume). */
export interface ThreadDocSummary {
  id: string;
  title: string;
  currentVersion: number;
  updatedAt: string;
}
