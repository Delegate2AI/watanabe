import { describe, it, expect, afterEach } from "vitest";
import {
  classifyImport,
  importedDocFromFile,
  maxImportBytes,
  maxRequestBytes,
  titleFromFilename,
} from "./import-doc";
import { docx, image, paragraph } from "@/test/docx-fixture";

const md = (text: string) => Buffer.from(text, "utf8");

afterEach(() => {
  delete process.env.DOC_IMPORT_MAX_BYTES;
});

describe("classifyImport", () => {
  it("reads the extension, whatever its case", () => {
    expect(classifyImport("notes.md")).toBe("markdown");
    expect(classifyImport("NOTES.Markdown")).toBe("markdown");
    expect(classifyImport("Brief.DOCX")).toBe("docx");
  });

  it("refuses everything else, including formats that look close", () => {
    expect(classifyImport("brief.doc")).toBeNull();
    expect(classifyImport("brief.pdf")).toBeNull();
    expect(classifyImport("notes")).toBeNull();
    expect(classifyImport("archive.docx.zip")).toBeNull();
  });
});

describe("titleFromFilename", () => {
  it("drops the extension and any leading path", () => {
    expect(titleFromFilename("/tmp/Q3 plan.md")).toBe("Q3 plan");
    expect(titleFromFilename("C:\\docs\\brief.docx")).toBe("brief");
  });

  it("reads separators as spaces", () => {
    expect(titleFromFilename("q3_launch-plan.md")).toBe("q3 launch plan");
  });

  it("falls back when the name is only an extension", () => {
    expect(titleFromFilename(".md")).toBe("Untitled document");
  });
});

describe("importedDocFromFile", () => {
  it("takes a markdown file as its own body", async () => {
    const result = await importedDocFromFile({ filename: "notes.md", bytes: md("# Plan\n\nBody text.") });
    expect(result).toMatchObject({ ok: true, doc: { title: "Plan", body: "# Plan\n\nBody text." } });
  });

  it("titles a file by its first heading, and by its filename when it has none", async () => {
    const heading = await importedDocFromFile({ filename: "raw.md", bytes: md("## Launch plan\n\ntext") });
    expect(heading.ok && heading.doc.title).toBe("Launch plan");

    const prose = await importedDocFromFile({ filename: "Q3 notes.md", bytes: md("Just a sentence.") });
    expect(prose.ok && prose.doc.title).toBe("Q3 notes");
  });

  it("bounds a very long heading", async () => {
    const result = await importedDocFromFile({ filename: "long.md", bytes: md(`# ${"a".repeat(400)}`) });
    expect(result.ok && result.doc.title.length).toBe(120);
  });

  it("strips a byte order mark and normalizes line endings", async () => {
    const result = await importedDocFromFile({
      filename: "windows.md",
      bytes: Buffer.from("\uFEFF# Title\r\n\r\nline\r\n", "utf8"),
    });
    expect(result.ok && result.doc.body).toBe("# Title\n\nline");
  });

  it("converts a docx and reports the images it left behind", async () => {
    const result = await importedDocFromFile({
      filename: "brief.docx",
      bytes: docx(paragraph("Quarterly plan", "Heading1"), image("A chart")),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.title).toBe("Quarterly plan");
    expect(result.doc.body).toContain("# Quarterly plan");
    expect(result.doc.droppedImages).toBe(1);
  });

  it("refuses a file type it cannot import", async () => {
    expect(await importedDocFromFile({ filename: "sheet.xlsx", bytes: md("x") })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("refuses a file over the cap before converting it", async () => {
    process.env.DOC_IMPORT_MAX_BYTES = "10";
    expect(maxImportBytes()).toBe(10);
    expect(await importedDocFromFile({ filename: "big.md", bytes: md("x".repeat(11)) })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("refuses a docx that inflates past the cap, which its compressed size hides", async () => {
    // Roughly 6 MiB of text compresses to a few kilobytes, so the file-size
    // check alone lets it through and the body lands in the database.
    const bomb = docx(paragraph("x".repeat(6 * 1024 * 1024)));
    expect(bomb.byteLength).toBeLessThan(maxImportBytes());
    expect(await importedDocFromFile({ filename: "bomb.docx", bytes: bomb })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("caps the converted body, not only the file it came from", async () => {
    process.env.DOC_IMPORT_MAX_BYTES = String(4 * 1024);
    const wordy = docx(paragraph("y".repeat(8 * 1024)));
    expect(wordy.byteLength).toBeLessThan(4 * 1024);
    expect(await importedDocFromFile({ filename: "wordy.docx", bytes: wordy })).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("allows for multipart overhead on top of the file cap", () => {
    expect(maxRequestBytes()).toBeGreaterThan(maxImportBytes());
  });

  it("refuses an empty file", async () => {
    expect(await importedDocFromFile({ filename: "empty.md", bytes: Buffer.alloc(0) })).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("refuses a whitespace-only file, which would create a document with no content", async () => {
    expect(await importedDocFromFile({ filename: "blank.md", bytes: md("\n\n   \n") })).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("refuses binary bytes wearing a markdown extension", async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]);
    expect(await importedDocFromFile({ filename: "trojan.md", bytes })).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("refuses a docx that will not parse, rather than throwing", async () => {
    expect(await importedDocFromFile({ filename: "corrupt.docx", bytes: md("not a zip at all") })).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });
});
