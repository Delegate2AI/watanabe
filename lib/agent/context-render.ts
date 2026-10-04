import {
  MAX_TOTAL_CONTEXT_BYTES,
  TRUNCATION_MARKER,
  CONTEXT_BLOCK_OPEN,
  CONTEXT_BLOCK_CLOSE,
  escapeContextDelimiters,
} from "./context";
import type { ResolvedContext } from "./context-resolve";
import type { Attachment } from "@/lib/attachments/read";

/**
 * Rendering + total-byte capping for the `<portal-context>` grounding block
 * (spec 11), split out of ./context-resolve.ts (which owns the vault-side
 * RESOLUTION of a client selection). This module owns only how resolved
 * context, vault selections AND, when `ATTACHMENTS_ENABLED` is on, thread
 * attachment content (spec 24 agent-read), is turned into the delimited block
 * the model sees.
 *
 * The import of `ResolvedContext` from ./context-resolve is TYPE-ONLY (erased
 * at compile time), so there is no runtime import cycle even though
 * ./context-resolve imports `capText` back from here.
 */

/** Head+tail truncation with the spec's exact marker, once `text` exceeds `maxLen`. */
export function capText(text: string, maxLen: number): { text: string; truncated: boolean } {
  if (text.length <= maxLen) return { text, truncated: false };
  const budget = Math.max(0, maxLen - TRUNCATION_MARKER.length - 2);
  const headLen = Math.floor(budget / 2);
  const tailLen = budget - headLen;
  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(text.length - tailLen) : "";
  return { text: `${head}\n${TRUNCATION_MARKER}\n${tail}`, truncated: true };
}

/** Enforces the total-context cap across every chip, truncating later chips first once the budget runs out. */
function enforceTotalCap(resolved: ResolvedContext[]): ResolvedContext[] {
  let budget = MAX_TOTAL_CONTEXT_BYTES;
  return resolved.map((r) => {
    const used = r.excerpt.length + r.enclosingSection.length;
    if (used <= budget) {
      budget -= used;
      return r;
    }
    const remaining = Math.max(0, budget);
    budget = 0;
    const excerptBudget = Math.floor(remaining / 2);
    const excerpt = capText(r.excerpt, excerptBudget);
    const enclosingSection = capText(r.enclosingSection, remaining - excerpt.text.length);
    return { ...r, excerpt: excerpt.text, enclosingSection: enclosingSection.text, truncated: true };
  });
}

function renderChip(r: ResolvedContext, index: number): string {
  const provenanceNote =
    r.provenance === "client"
      ? "client-supplied (could not verify against current vault content)"
      : r.provenance;
  return [
    `[${index}] path: ${escapeContextDelimiters(r.path)}`,
    `    heading trail: ${escapeContextDelimiters(r.headingTrail.join(" > ") || "(none)")}`,
    `    lines: ${r.startLine}-${r.endLine}`,
    `    provenance: ${provenanceNote}`,
    `    excerpt:`,
    escapeContextDelimiters(r.excerpt),
    `    enclosing section (bounded):`,
    escapeContextDelimiters(r.enclosingSection),
  ].join("\n");
}

export type AttachmentContext = Attachment;

const ATTACHMENT_NOTE =
  "The files listed below are on disk at the paths given: open them with `Read` (images and PDFs render). " +
  "When a connector tool needs a file's content, read the file first and pass the content as the tool's arguments.";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function renderAttachmentChips(attachments: AttachmentContext[], budget: number): string[] {
  let remaining = Math.max(0, budget);
  const out: string[] = [];
  for (const att of attachments) {
    const header =
      `[attachment: ${escapeContextDelimiters(att.name)}] ` +
      `path=${escapeContextDelimiters(att.path)} type=${att.mimeType} size=${formatSize(att.size)}`;
    if (att.text === undefined || remaining <= 0) {
      out.push(header);
      continue;
    }
    const capped = capText(att.text, remaining);
    remaining -= capped.text.length;
    out.push([header, `    content:`, escapeContextDelimiters(capped.text)].join("\n"));
  }
  return out;
}

export function renderContextBlock(
  resolved: ResolvedContext[],
  attachments: AttachmentContext[] = [],
): string {
  const capped = enforceTotalCap(resolved);
  const chips = capped.map((r, i) => renderChip(r, i + 1));
  const usedByDocs = capped.reduce((n, r) => n + r.excerpt.length + r.enclosingSection.length, 0);
  const attachmentChips = renderAttachmentChips(attachments, MAX_TOTAL_CONTEXT_BYTES - usedByDocs);
  const allChips =
    attachmentChips.length > 0 ? [...chips, ATTACHMENT_NOTE, ...attachmentChips] : chips;
  return `${CONTEXT_BLOCK_OPEN}\n${allChips.join("\n")}\n${CONTEXT_BLOCK_CLOSE}`;
}
