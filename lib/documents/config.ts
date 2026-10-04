import { isFlagEnabled } from "@/lib/config/flags";

/** Unified documents feature flag. Defaults off. */
export function isUnifiedDocsEnabled(): boolean {
  return process.env.UNIFIED_DOCS === "1";
}

/**
 * Whether the assistant may author a document as a designed HTML page rather
 * than as markdown
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Gates the WRITE, not the read. Flag-off refuses a new HTML version but keeps
 * rendering the ones already stored, because a document that vanished from its
 * author's canvas the moment an operator reached for the kill switch would be a
 * worse failure than the one the switch is there to stop.
 */
export function isHtmlDocumentsEnabled(): boolean {
  return isFlagEnabled("HTML_DOCUMENTS_ENABLED");
}
