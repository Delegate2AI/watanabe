/**
 * Makes a model-authored page safe to render and safe to hand to somebody
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Pure string work, no `node:` import and no DOM: this is imported by a client
 * island (`components/ui/html-document.tsx`) as well as by the server pipeline,
 * and both need the identical answer.
 *
 * Why it exists at all, given the viewer already renders inside a sandboxed
 * frame with a Content-Security-Policy: the policy used to be injected by
 * searching the body text for `<head>`, so a body beginning `<!-- <head> -->`
 * put the policy inside a comment and the page rendered with none. `sandbox=""`
 * still blocked script and same-origin access but NOT a passive `<img>`, so a
 * shared document could report its reader's address to whoever wrote it.
 *
 * Two independent controls now, neither carrying the weight alone: the wrapper
 * is BUILT rather than found, so the policy is unconditionally first in a head
 * we made, and the markup is stripped of the things that reach the network or
 * execute. A document is also downloaded and opened outside any frame we
 * control, which is the case the CSP alone never covered.
 */

/** Tags removed entirely, contents and all. */
const DROPPED_ELEMENTS = /<(script|iframe|object|embed|applet|frame|frameset)\b[\s\S]*?<\/\1\s*>/gi;
/** The same tags when self-closed or left unclosed. */
const DROPPED_VOID = /<\/?(script|iframe|object|embed|applet|frame|frameset|base|link|meta)\b[^>]*>/gi;
/**
 * `onclick=`, `onerror=` and the rest, quoted or bare.
 *
 * The separator class is `[\s/]`, not `\s`. A solidus is a valid attribute
 * separator in HTML, so `<svg/onload=...>` parses as an svg with an onload
 * handler, and a rule that only accepted whitespace let it straight through.
 */
const EVENT_HANDLERS = /[\s/]on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
/**
 * A `src`/`href`/`srcset`/`poster`/`data` pointing anywhere but at inline data
 * or at a fragment on the page itself.
 *
 * The unquoted alternative excludes quote characters deliberately: without that
 * it also matched a QUOTED `data:` value, because the negative lookahead sees
 * the opening quote rather than the scheme and happily succeeds.
 */
const REMOTE_REFERENCE =
  /[\s/](?:src|srcset|href|poster|data|formaction|xlink:href)\s*=\s*(?:"(?!data:|#)[^"]*"|'(?!data:|#)[^']*'|(?!data:|#|["'])[^\s>]+)/gi;
/** The outer document scaffolding, tags only. Contents are kept. */
const WRAPPER_TAGS = /<\/?(?:html|head|body)\b[^>]*>/gi;
const DOCTYPE = /<!doctype[^>]*>/gi;

/**
 * Strip the outer `<!doctype>`, `<html>`, `<head>` and `<body>` tags, keeping
 * everything that was inside them.
 *
 * So the caller can put the content into a document it built itself, rather than
 * trying to find the author's head and inject into it. A `<style>` block that
 * lived in the author's head keeps working: it is valid in the body too.
 */
export function unwrapDocument(html: string): string {
  return html.replace(DOCTYPE, "").replace(WRAPPER_TAGS, "");
}

/**
 * The body of a designed document with everything executable or network-reaching
 * taken out. Styling, inline SVG and `data:` images all survive, because those
 * are what a designed page is made of.
 */
export function sanitizeDocumentHtml(html: string): string {
  if (typeof html !== "string" || html.trim() === "") return "";
  try {
    let out = unwrapDocument(html);
    // Paired form first so the CONTENTS go with the tag, then the unpaired form
    // for anything self-closed, unclosed, or void by definition.
    out = out.replace(DROPPED_ELEMENTS, "").replace(DROPPED_VOID, "");
    out = out.replace(EVENT_HANDLERS, "").replace(REMOTE_REFERENCE, "");
    return out.trim();
  } catch {
    // Cannot realistically throw, but this is on a render path that must not.
    return "";
  }
}
