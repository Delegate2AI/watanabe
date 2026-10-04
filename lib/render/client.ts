import { docRenderTimeoutMs, docRenderUrl, isDocRenderEnabled } from "./config";
import { log } from "@/lib/log";

/**
 * Talks to the document render sidecar
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * NEVER THROWS, and that is the contract, not a convenience. The caller is a
 * document save: the body is already stored by the time this runs, so a Chromium
 * pod that is restarting must cost the document its PDF and nothing else. Every
 * failure, including a timeout, a non-JSON body from an ingress error page, and
 * a payload missing a field, comes back as `null`.
 *
 * The sidecar is deliberately dumb: it takes markup and gives back bytes. It
 * holds no state, reads no database, and is reachable only in-cluster.
 */

export interface RenderedDocument {
  pdf: Buffer;
  /** The same page with fonts inlined and mermaid fences turned into SVG. */
  html: string;
}

/** The shape the sidecar answers with. Validated before use, never trusted. */
function parsePayload(value: unknown): RenderedDocument | null {
  if (typeof value !== "object" || value === null) return null;
  const { pdf, html } = value as { pdf?: unknown; html?: unknown };
  if (typeof pdf !== "string" || pdf === "") return null;
  if (typeof html !== "string" || html === "") return null;
  const bytes = Buffer.from(pdf, "base64");
  if (bytes.length === 0) return null;
  return { pdf: bytes, html };
}

/**
 * What to draw: either a designed page the assistant wrote, or a markdown body
 * plus the stylesheet to print it with.
 *
 * Markdown is converted in the SIDECAR rather than here, which is a deviation
 * from the spec recorded in the implementation notes. Next.js refuses
 * `react-dom/server` anywhere in the App Router bundle, so rendering markdown to
 * HTML in process through the app's own React pipeline fails the build outright.
 * The sidecar has no such constraint. The stylesheet still travels from here, so
 * the app keeps owning how an exported document looks.
 */
export interface RenderInput {
  title: string;
  html?: string;
  markdown?: string;
  css?: string;
}

export async function renderDesignedDocument(input: RenderInput): Promise<RenderedDocument | null> {
  if (!isDocRenderEnabled()) return null;
  const source = input.html ?? input.markdown ?? "";
  if (typeof source !== "string" || source.trim() === "") return null;

  const base = docRenderUrl();
  if (!base) return null;

  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        ...(input.html === undefined ? {} : { html: input.html }),
        ...(input.markdown === undefined ? {} : { markdown: input.markdown, css: input.css }),
      }),
      signal: AbortSignal.timeout(docRenderTimeoutMs()),
    });
    if (!response.ok) {
      log.warn("doc render refused", { status: response.status });
      return null;
    }
    return parsePayload(await response.json());
  } catch (e) {
    // Includes the timeout abort and a non-JSON body from an ingress error page.
    log.warn("doc render unavailable", { err: String(e) });
    return null;
  }
}
