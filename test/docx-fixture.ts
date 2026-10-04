/** A minimal but real `.docx` package, built in process rather than committed. */
import AdmZip from "adm-zip";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const PACKAGE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/pic.png"/>
</Relationships>`;

const NAMESPACES = [
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
].join(" ");

/** A `<w:p>` in a named paragraph style. */
export function paragraph(text: string, style?: string): string {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

/** A paragraph carrying one bold run, to prove inline formatting survives. */
export function boldParagraph(plain: string, bold: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${plain}</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>${bold}</w:t></w:r></w:p>`;
}

/** A table with no header row, which is what Word produces. */
export function table(rows: string[][]): string {
  const cells = rows
    .map((row) => `<w:tr>${row.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`)
    .join("");
  return `<w:tbl>${cells}</w:tbl>`;
}

/** An inline image with alt text, referencing the media part below. */
export function image(altText: string): string {
  return `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="${altText}"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic>
</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/** Package the given body parts as a `.docx` buffer. */
export function docx(...parts: string[]): Buffer {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NAMESPACES}><w:body>${parts.join("")}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile("[Content_Types].xml", Buffer.from(CONTENT_TYPES));
  zip.addFile("_rels/.rels", Buffer.from(PACKAGE_RELS));
  zip.addFile("word/_rels/document.xml.rels", Buffer.from(DOCUMENT_RELS));
  zip.addFile("word/document.xml", Buffer.from(document));
  // Real PNG bytes, so a converter that reads images would succeed unnoticed.
  zip.addFile(
    "word/media/pic.png",
    Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"),
  );
  return zip.toBuffer();
}
