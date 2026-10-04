/**
 * An uploaded file to the markdown body of a new shared document. Knows nothing
 * of requests or the database; reports failure as a reason instead of throwing.
 */
import { docxToMarkdown, inflatedContentBytes } from "./docx";
import { boundTitle, firstLineTitle } from "./title";

/** What kind of file this is. Anything else is refused. */
export type ImportKind = "markdown" | "docx";

/** Every way an import can be refused. The route maps these onto error codes. */
export type ImportFailure = "unsupported" | "too_large" | "unreadable";

export interface ImportedDoc {
  title: string;
  body: string;
  /** Images dropped from a `.docx` (their alt text is kept inline). */
  droppedImages: number;
}

export type ImportResult = { ok: true; doc: ImportedDoc } | { ok: false; reason: ImportFailure };

const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;
const DOCX_EXTENSION = ".docx";

/**
 * Hard per-file cap, overridable with `DOC_IMPORT_MAX_BYTES`. Smaller than the
 * attachment cap: this becomes a row in SQLite, not a file on the disk.
 */
export function maxImportBytes(): number {
  const raw = Number(process.env.DOC_IMPORT_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 1024 * 1024;
}

/** The whole multipart request: the file, plus part headers and boundaries. */
export function maxRequestBytes(): number {
  return maxImportBytes() + 64 * 1024;
}

/**
 * What a file is, by extension. Not by MIME type: browsers send `.docx` as the
 * OOXML type, as `application/octet-stream`, or as nothing at all. The bytes are
 * checked by the converter that reads them.
 */
export function classifyImport(filename: string): ImportKind | null {
  const name = filename.trim().toLowerCase();
  if (MARKDOWN_EXTENSIONS.some((ext) => name.endsWith(ext))) return "markdown";
  if (name.endsWith(DOCX_EXTENSION)) return "docx";
  return null;
}

/** The filename without its extension, as the title of last resort. */
export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const stem = base.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return boundTitle(stem) || "Untitled document";
}

/** A NUL byte means this is not text, whatever the extension says. */
function looksBinary(text: string): boolean {
  return text.includes("\u0000");
}

/** Decode markdown: drop the BOM, normalize CRLF, and refuse binary. */
function decodeMarkdown(bytes: Buffer): string | null {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  return looksBinary(text) ? null : text;
}

/** The first heading names the document. Without one, the filename does. */
function titleForImport(filename: string, body: string): string {
  const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (/^#{1,6}\s+\S/.test(firstLine)) return firstLineTitle(body) || titleFromFilename(filename);
  return titleFromFilename(filename);
}

/** Convert one uploaded file into the seed of a new shared document. */
export async function importedDocFromFile(file: {
  filename: string;
  bytes: Buffer;
}): Promise<ImportResult> {
  const limit = maxImportBytes();
  const kind = classifyImport(file.filename);
  if (kind === null) return { ok: false, reason: "unsupported" };
  if (file.bytes.byteLength === 0) return { ok: false, reason: "unreadable" };
  if (file.bytes.byteLength > limit) return { ok: false, reason: "too_large" };

  let body: string;
  let droppedImages = 0;
  if (kind === "markdown") {
    const decoded = decodeMarkdown(file.bytes);
    if (decoded === null) return { ok: false, reason: "unreadable" };
    body = decoded.trim();
  } else {
    try {
      // The cap so far bounds the compressed bytes only.
      inflatedContentBytes(file.bytes, limit);
      const converted = await docxToMarkdown(file.bytes);
      body = converted.markdown;
      droppedImages = converted.droppedImages;
    } catch (e) {
      // RangeError is what both the size check and zlib's own bounded inflate
      // raise, so a lying zip header lands here as too large, not as a fault.
      if (e instanceof RangeError) return { ok: false, reason: "too_large" };
      // A renamed binary, a corrupt zip, or a legacy `.doc`: none is a 500.
      return { ok: false, reason: "unreadable" };
    }
  }

  if (body.trim() === "") return { ok: false, reason: "unreadable" };
  // The header can lie about what an entry inflates to; the result cannot.
  if (Buffer.byteLength(body, "utf8") > limit) return { ok: false, reason: "too_large" };

  return {
    ok: true,
    doc: {
      title: titleForImport(file.filename, body),
      body,
      droppedImages,
    },
  };
}
