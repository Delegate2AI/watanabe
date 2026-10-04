import { describe, it, expect } from "vitest";
import { docxToMarkdown } from "./docx";
import { boldParagraph, docx, image, paragraph, table } from "@/test/docx-fixture";

describe("docxToMarkdown", () => {
  it("keeps headings and inline formatting", async () => {
    const { markdown } = await docxToMarkdown(
      docx(paragraph("Quarterly plan", "Heading1"), boldParagraph("Signed off by ", "Alice")),
    );
    expect(markdown).toContain("# Quarterly plan");
    expect(markdown).toContain("Signed off by **Alice**");
  });

  it("keeps a Word table as a markdown table, treating its first row as the header", async () => {
    const { markdown } = await docxToMarkdown(
      docx(table([["Region", "Revenue"], ["EMEA", "12"], ["APAC", "8"]])),
    );
    expect(markdown).toContain("| Region | Revenue |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("| EMEA | 12 |");
    // The mammoth markdown converter this replaced emitted every cell as its own
    // paragraph, which is the regression this asserts against.
    expect(markdown).not.toContain("<table");
  });

  it("escapes a pipe inside a cell so the row survives", async () => {
    const { markdown } = await docxToMarkdown(docx(table([["a | b", "c"]])));
    expect(markdown).toContain("| a \\| b | c |");
  });

  it("drops images, keeps their alt text, and counts them", async () => {
    const { markdown, droppedImages } = await docxToMarkdown(
      docx(paragraph("Before"), image("A chart of revenue"), paragraph("After")),
    );
    expect(droppedImages).toBe(1);
    expect(markdown).toContain("A chart of revenue");
    expect(markdown).not.toContain("data:image");
    expect(markdown).not.toContain("![");
  });

  it("reports no dropped images for a document with none", async () => {
    const { droppedImages } = await docxToMarkdown(docx(paragraph("Just words")));
    expect(droppedImages).toBe(0);
  });

  it("rejects bytes that are not a docx", async () => {
    await expect(docxToMarkdown(Buffer.from("this is not a zip"))).rejects.toThrow();
  });
});
