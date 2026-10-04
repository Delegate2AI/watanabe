import { isHtmlDocumentsEnabled } from "@/lib/documents/config";

/**
 * Config surface for the document render sidecar
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * Two gates, and BOTH have to hold for a PDF to be produced:
 *  - `HTML_DOCUMENTS_ENABLED`, the feature flag.
 *  - `DOC_RENDER_URL`, the sidecar address.
 *
 * That second gate is the one that bites. Dictation shipped with exactly this
 * shape, its flag on in stage and prod and its backend URL set nowhere, so the
 * feature was off in both environments while the flag panel said it was on and
 * nothing logged a reason. `lib/render/deploy-config.test.ts` is the guard: it
 * reads the real helm values and fails if a deployment turns the flag on without
 * giving it an address.
 */

/** The render sidecar's address, if one is configured. */
export function docRenderUrl(): string | undefined {
  const url = process.env.DOC_RENDER_URL?.trim();
  return url && url.length > 0 ? url : undefined;
}

/**
 * How long to wait on the sidecar. A cold Chromium plus a long document is
 * slower than a normal request, and the caller is a background render, so the
 * ceiling is generous. Overridable for a slow cluster.
 */
export function docRenderTimeoutMs(): number {
  const raw = Number(process.env.DOC_RENDER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
}

/**
 * Whether a PDF and a self-contained HTML can actually be produced right now.
 *
 * False does NOT mean the feature is off. The markdown copy is derived in-process
 * (`lib/render/markdown.ts`) and the designed page still renders in the canvas
 * from its stored body: what is lost when this is false is the two downloadable
 * files, and nothing else.
 */
export function isDocRenderEnabled(): boolean {
  return isHtmlDocumentsEnabled() && docRenderUrl() !== undefined;
}
