/**
 * `.docx` to markdown: mammoth to HTML, then turndown to markdown. mammoth's own
 * `convertToMarkdown` is not usable here because it drops table structure.
 */
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { createTurndown } from "@/lib/markdown/turndown";

/** What a converted document carries back to the importer. */
export interface DocxConversion {
  markdown: string;
  /** How many images were dropped, so the UI can say so. */
  droppedImages: number;
}

/** Never reads the image bytes. mammoth still fills in the alt text. */
const DROP_IMAGES = mammoth.images.imgElement(() => Promise.resolve({ src: "" }));

/**
 * How much text this archive really holds, refusing anything over `limit`.
 *
 * A `.docx` is a zip, so a few kilobytes on the wire can inflate to hundreds of
 * megabytes and the file-size cap alone does not bound it. The declared sizes
 * are checked first, then every entry is actually inflated here: adm-zip passes
 * the declared size to zlib as `maxOutputLength`, so a header that understates
 * its entry throws instead of expanding, and it throws HERE, before mammoth's
 * own unzip sees the file. Same approach as `lib/packages/normalize.ts`.
 *
 * Throws if the bytes are not a readable zip or if the archive is over `limit`.
 */
export function inflatedContentBytes(buffer: Buffer, limit: number): number {
  const entries = new AdmZip(buffer).getEntries();
  let declared = 0;
  for (const entry of entries) {
    declared += entry.header.size || 0;
    if (declared > limit) throw new RangeError("docx expands past the import limit");
  }
  let actual = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    actual += entry.getData().length;
    if (actual > limit) throw new RangeError("docx expands past the import limit");
  }
  return actual;
}

/** Convert one `.docx` buffer to markdown. Throws only if the file is not a readable docx. */
export async function docxToMarkdown(buffer: Buffer): Promise<DocxConversion> {
  const { value: html } = await mammoth.convertToHtml({ buffer }, { convertImage: DROP_IMAGES });
  const droppedImages = html.match(/<img\b/gi)?.length ?? 0;
  const markdown = createTurndown().turndown(html).trim();
  return { markdown, droppedImages };
}
