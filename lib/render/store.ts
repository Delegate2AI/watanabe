import fs from "node:fs";
import path from "node:path";
import { log } from "@/lib/log";
import { ownerKey, safeSegment } from "./store-key";

/**
 * Where the three rendered files for a document version live
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * On the pod PVC, a sibling of the attachments directory and outside the KB
 * vault, keyed OWNER then DOCUMENT then VERSION. The owner segment is a SHA-256
 * of the raw email rather than a slug, matching `lib/attachments/store.ts`: a
 * slug maps `a.b@x.com` and `a-b@x.com` onto one directory, which would put one
 * person's documents in another person's folder. The email itself never appears
 * in a path.
 *
 * A rendered file is a CACHE. Everything here can be regenerated from the stored
 * body, so every read returns `null` rather than throwing on a miss, and a failed
 * write is reported rather than raised: losing a PDF must never cost a save.
 */

/** The three things a document version can be downloaded as. */
export type RenderKind = "pdf" | "html" | "md";

export interface RenderRef {
  ownerEmail: string;
  docId: string;
  version: number;
  kind: RenderKind;
}

/**
 * Base directory. Overridable via `DOC_RENDERS_DIR` (local dev without a `/data`
 * mount); defaults to `/data/renders`, beside `/data/attachments` under the one
 * PVC mount so the two never collide.
 */
export function rendersRoot(): string {
  const override = process.env.DOC_RENDERS_DIR?.trim();
  return override ? path.resolve(process.cwd(), override) : "/data/renders";
}

export { ownerKey } from "./store-key";

export function renderDirFor(ownerEmail: string, docId: string): string {
  return path.join(rendersRoot(), ownerKey(ownerEmail), safeSegment(docId));
}

function fileFor(ref: RenderRef): string {
  const version = Number.isSafeInteger(ref.version) && ref.version > 0 ? ref.version : 1;
  return path.join(renderDirFor(ref.ownerEmail, ref.docId), `v${version}.${ref.kind}`);
}

/** The stored bytes, or `null` when this version was never rendered. */
export function readRender(ref: RenderRef): Buffer | null {
  try {
    return fs.readFileSync(fileFor(ref));
  } catch {
    return null;
  }
}

/**
 * Persist one rendered file, overwriting a previous render of the same version.
 * Returns whether it landed: a full disk or an unmounted PVC is worth a log line
 * and a `false`, never an exception into a save path.
 */
export function writeRender(ref: RenderRef & { bytes: Buffer }): boolean {
  const file = fileFor(ref);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ref.bytes);
    return true;
  } catch (e) {
    log.warn("render store write failed", { kind: ref.kind, err: String(e) });
    return false;
  }
}
