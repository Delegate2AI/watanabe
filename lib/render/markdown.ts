import { createTurndown } from "@/lib/markdown/turndown";

/**
 * The markdown copy of a designed HTML document
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Runs in the app rather than in the render sidecar, which is a deviation from
 * the spec recorded in the implementation notes. Two reasons: it derives from
 * the ORIGINAL body, before the sidecar turns a mermaid fence into a serialized
 * `<svg>`, and it keeps working when the sidecar is down, which matters because
 * the KB publish path reads its output.
 *
 * Never throws. A body that is not really markup yields whatever text can be
 * recovered from it, never an exception: the caller is a save path, and a
 * document must not fail to save because its derived copy was awkward.
 */

const SVG_ELEMENT = /<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi;
const ACCESSIBLE_NAME = /\b(?:aria-label|title)\s*=\s*["']([^"']*)["']/i;

/**
 * A figure becomes its accessible name, not its source.
 *
 * A designed page draws its charts as hand-authored inline SVG, which would
 * otherwise reach the markdown as hundreds of lines of path data in the middle
 * of a vault note. The name the author already wrote for a screen reader is the
 * right caption, so it is reused.
 *
 * Done as a pre-pass rather than as a turndown rule because turndown checks
 * `blankRule` first, and an `<svg>` holding only shapes has no text content, so
 * it is treated as blank and removed before any custom rule is consulted.
 */
function captionFigures(html: string): string {
  return html.replace(SVG_ELEMENT, (element) => {
    const name = ACCESSIBLE_NAME.exec(element)?.[1]?.trim();
    return `<p><em>[${name || "diagram"}]</em></p>`;
  });
}

export function htmlToMarkdown(html: string): string {
  if (typeof html !== "string" || html.trim() === "") return "";
  try {
    const service = createTurndown();
    // Dropped entirely rather than converted. A `<style>` block is the whole
    // point of a designed page and would otherwise arrive as a wall of CSS in
    // the prose; `<script>` must not reach a vault note in any form.
    service.remove(["style", "script", "noscript"]);
    return service.turndown(captionFigures(html)).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    // Last resort: strip the tags and keep the words. Better than a save that
    // fails because a document was malformed in a way turndown disliked.
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}
