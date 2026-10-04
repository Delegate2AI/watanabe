import type { DocFormat } from "@/lib/documents/types";
import { log } from "@/lib/log";
import { renderDesignedDocument } from "./client";
import { htmlToMarkdown } from "./markdown";
import { PRINT_STYLES } from "./print-styles";
import { sanitizeDocumentHtml } from "./sanitize";
import { writeRender } from "./store";

/** HTML-escape for the one place a value is interpolated into markup by hand. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A designed body wrapped back into a complete document, with everything
 * executable or network-reaching removed.
 *
 * Sanitizing before the sidecar rather than after matters because the file it
 * returns is DOWNLOADED. Once a person opens that file from their disk, neither
 * the viewer's sandbox nor its Content-Security-Policy is anywhere near it, so a
 * surviving `<script>` or remote `<img>` would run against them directly.
 */
function buildDesignedPage(body: string, title: string): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    "</head><body>",
    sanitizeDocumentHtml(body),
    "</body></html>",
  ].join("");
}

/**
 * One saved version in, three downloadable files out
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Every document gets all three, designed or not: a markdown body is wrapped
 * into a printable page first, a designed body goes to the sidecar verbatim.
 *
 * Degrades in one direction only. The markdown copy is derived in process and is
 * written first, so a sidecar that is down costs the PDF and the self-contained
 * HTML and never the markdown. That ordering is load-bearing: the KB publish
 * path reads the markdown, and it must not depend on a Chromium pod.
 *
 * Never throws. The caller is a document save that has already stored the body.
 */

export interface RenderOutcome {
  md: boolean;
  html: boolean;
  pdf: boolean;
}

export interface RenderRequest {
  ownerEmail: string;
  docId: string;
  version: number;
  title: string;
  body: string;
  format: DocFormat;
}

export async function renderDocumentExports(request: RenderRequest): Promise<RenderOutcome> {
  const { ownerEmail, docId, version, title, body, format } = request;
  const designed = format === "html";

  // First, and without the network: this is the copy everything else can fall
  // back to, and the one the publish path needs.
  const markdown = designed ? htmlToMarkdown(body) : body;
  const outcome: RenderOutcome = {
    md: writeRender({ ownerEmail, docId, version, kind: "md", bytes: Buffer.from(markdown, "utf8") }),
    html: false,
    pdf: false,
  };

  // A designed page keeps its own CSS and layout; wrapping it in ours would
  // fight it. It is sanitized first, because the file the sidecar returns is
  // downloaded and opened outside any frame we control, where neither the
  // viewer's sandbox nor its policy reaches. A markdown body has no page of its
  // own, so it gets one.
  //
  // Inside a try: this runs on a download request as well as after a save, and
  // `markdownToStandalonePage` runs a full remark/rehype pass, which a
  // pathological body (thousands of nested blockquotes) can overflow the stack
  // on. That must degrade to "no PDF", never to a 500 on a document that saved.
  let rendered = null;
  try {
    rendered = designed
      ? await renderDesignedDocument({ title, html: buildDesignedPage(body, title) })
      : await renderDesignedDocument({ title, markdown: body, css: PRINT_STYLES });
  } catch (e) {
    log.warn("doc render could not build the page", { docId, err: String(e) });
  }
  if (!rendered) return outcome;

  outcome.html = writeRender({
    ownerEmail,
    docId,
    version,
    kind: "html",
    bytes: Buffer.from(rendered.html, "utf8"),
  });
  outcome.pdf = writeRender({ ownerEmail, docId, version, kind: "pdf", bytes: rendered.pdf });
  return outcome;
}
