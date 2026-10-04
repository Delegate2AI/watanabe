import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { log } from "@/lib/log";
import type { AgentEvent } from "./events";
import type { ConnectorGrants } from "@/lib/connectors/grants";
import { normalizeMessage } from "./normalize";
import { broadcastInitNotices } from "./session-turn";

/** What the drain loop needs from its session — closures, so privates stay private. */
export interface DrainHost {
  query: AsyncIterable<SDKMessage>;
  sdkSessionId(): string | null;
  hasRegistered(): boolean;
  /** First time the SDK reports its session id — the session's `register()`. */
  adoptSessionId(sid: string): void;
  connectorGrants: ConnectorGrants;
  broadcast(event: AgentEvent): void;
  onTurnResult(msg: Extract<SDKMessage, { type: "result" }>): void;
  /** The query loop has ended (subprocess gone) — clear busy, mark ended, deregister. */
  onLoopEnd(): void;
}

/**
 * The session's message loop, split out of `AgentSession` (file-size split;
 * behavior unchanged): iterate the SDK query, adopt the session id, surface
 * init-message connector notices, route turn results to the bookkeeping, and
 * normalize everything else into broadcast events.
 */
export async function drainQuery(host: DrainHost): Promise<void> {
  try {
    for await (const msg of host.query) {
      const sid = (msg as { session_id?: string }).session_id;
      if (sid && !host.hasRegistered()) host.adoptSessionId(sid);
      if (msg.type === "system" && msg.subtype === "init") {
        broadcastInitNotices(msg.mcp_servers, host.connectorGrants, host.broadcast);
      }
      if (msg.type === "result") {
        host.onTurnResult(msg);
        continue;
      }
      for (const event of normalizeMessage(msg)) host.broadcast(event);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Surface the failure operator-side too — the browser gets an error event
    // but the server was previously silent about a dead query loop.
    log.error("agent turn error", { sessionId: host.sdkSessionId(), err: message });
    host.broadcast({ type: "error", message });
  } finally {
    host.onLoopEnd();
  }
}
