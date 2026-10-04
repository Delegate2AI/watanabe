import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Spec 29 feature flag. `CANVAS_ENABLED` gates the whole in-chat documents and
 * canvas subsystem: the `doc_write` MCP tool (registered only when on, and
 * allowed by the permission gate only when on), the `/api/chat-docs` routes
 * (404 when off), and the canvas pane in the chat surface. Defaults off, so
 * flag-off leaves every existing byte-path identical: the chat renders exactly
 * as today with no canvas pane, and `doc_write` is not registered.
 */
export function isCanvasEnabled(): boolean {
  return isFlagEnabled("CANVAS_ENABLED");
}
