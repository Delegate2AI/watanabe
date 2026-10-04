"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { sanitizeDocumentHtml } from "@/lib/render/sanitize";

/**
 * Renders a document whose body IS HTML, written by the assistant
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Never through the markdown pipeline, and never into the portal's own DOM. The
 * markdown renderer sets `proseSkipHtml`, which drops raw HTML rather than
 * printing it, so sending a designed page through it produces an empty document;
 * turning that off instead would put model-authored markup into the page that
 * holds the reader's session. Both are refused here.
 *
 * The frame is the boundary. It gets `srcdoc` (nothing is fetched to display
 * it), a `sandbox` that withholds BOTH `allow-same-origin` and `allow-scripts`,
 * and a `default-src 'none'` policy of our own injected ahead of anything the
 * body carries. The reason the sandbox matters more than it first appears: an
 * HTML document can be shared, so the person rendering it is often not the
 * person whose session produced it.
 */

/**
 * Our policy, first in document order.
 *
 * The first Content-Security-Policy meta a parser sees is the one that binds,
 * and a later one can only narrow the result, never widen it. So a body that
 * arrives carrying `default-src *` cannot loosen this by being parsed after it.
 *
 * `style-src 'unsafe-inline'` is what makes a designed page possible at all: the
 * whole point is a `<style>` block, and with `sandbox` withholding
 * `allow-scripts` there is no script for an inline style to cooperate with.
 * `img-src data:` allows an embedded figure without allowing a remote fetch.
 */
const POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

/**
 * Builds the document the frame renders: our head, then the sanitized body.
 *
 * The wrapper is BUILT, never found. A previous version injected the policy
 * after a `<head>` it located by searching the body text, so a body beginning
 * `<!-- <head> -->` put the policy inside a comment and the page rendered with
 * no policy at all. `sandbox=""` still blocked script and same-origin access,
 * but not a passive `<img>`, so a shared document could report its reader's
 * address to whoever wrote it. There is no search here to fool.
 *
 * The sanitizer is the second, independent control: even with the policy in
 * place, the same body is also downloaded and opened outside any frame we own.
 */
function frameDocument(html: string): string {
  return [
    "<!doctype html><html><head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`,
    "</head><body>",
    sanitizeDocumentHtml(html),
    "</body></html>",
  ].join("");
}

export function HtmlDocument({
  html,
  title,
  className,
}: {
  html: string;
  /** Also the frame's accessible name, so it is not an unlabelled region. */
  title: string;
  className?: string;
}) {
  const srcDoc = useMemo(() => frameDocument(html), [html]);

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      // Empty on purpose, not omitted. An absent `sandbox` is no sandbox at all,
      // while an empty one is the most restrictive setting there is: every
      // capability withheld, including scripts, same-origin, forms and popups.
      sandbox=""
      className={cn("h-full w-full border-0 bg-white", className)}
    />
  );
}
