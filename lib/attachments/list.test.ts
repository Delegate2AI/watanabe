import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storeAttachment, attachmentDirFor } from "./store";
import { listAttachments, MAX_INLINE_TEXT_BYTES } from "./read";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "attach-list-"));
  process.env.ATTACHMENTS_DIR = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ATTACHMENTS_DIR;
});

describe("listAttachments, the manifest", () => {
  it("lists every accepted type, not only text", () => {
    for (const [filename, mimeType] of [
      ["pic.png", "image/png"],
      ["scan.pdf", "application/pdf"],
      ["rows.csv", "text/csv"],
      ["cfg.json", "application/json"],
      ["notes.md", "text/markdown"],
    ] as const) {
      storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename, mimeType, bytes: Buffer.from("x") });
    }
    const names = listAttachments("a@x.com", "t")
      .map((a) => a.name)
      .sort();
    expect(names).toEqual(["cfg.json", "notes.md", "pic.png", "rows.csv", "scan.pdf"]);
  });

  it("carries the id, an absolute in-dir path, the inferred mime type and the size", () => {
    const chip = storeAttachment({
      ownerEmail: "a@x.com",
      threadId: "t",
      filename: "report.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 body"),
    });
    const [entry] = listAttachments("a@x.com", "t");
    expect(entry.id).toBe(chip.id);
    expect(entry.name).toBe("report.pdf");
    expect(entry.mimeType).toBe("application/pdf");
    expect(entry.size).toBe(Buffer.from("%PDF-1.4 body").length);
    expect(path.isAbsolute(entry.path)).toBe(true);
    expect(path.dirname(entry.path)).toBe(fs.realpathSync(attachmentDirFor("a@x.com", "t")));
    expect(fs.readFileSync(entry.path, "utf8")).toBe("%PDF-1.4 body");
  });

  it("infers the mime type from the extension, not from what was uploaded", () => {
    storeAttachment({
      ownerEmail: "a@x.com",
      threadId: "t",
      filename: "rows.csv",
      mimeType: "application/octet-stream",
      bytes: Buffer.from("a,b"),
    });
    expect(listAttachments("a@x.com", "t")[0].mimeType).toBe("text/csv");
  });
});

describe("listAttachments, inline text", () => {
  it("inlines text under the cutoff", () => {
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "n.md", mimeType: "text/markdown", bytes: Buffer.from("# hi") });
    expect(listAttachments("a@x.com", "t")[0].text).toBe("# hi");
  });

  it("inlines csv and json as text", () => {
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "r.csv", mimeType: "text/csv", bytes: Buffer.from("a,b\n1,2") });
    storeAttachment({
      ownerEmail: "a@x.com",
      threadId: "t",
      filename: "c.json",
      mimeType: "application/json",
      bytes: Buffer.from(`{"k":1}`),
    });
    const byName = Object.fromEntries(listAttachments("a@x.com", "t").map((a) => [a.name, a.text]));
    expect(byName["r.csv"]).toBe("a,b\n1,2");
    expect(byName["c.json"]).toBe(`{"k":1}`);
  });

  it("leaves text over the cutoff unread, listing it without a text field", () => {
    const big = "x".repeat(MAX_INLINE_TEXT_BYTES + 1);
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "big.txt", mimeType: "text/plain", bytes: Buffer.from(big) });
    const [entry] = listAttachments("a@x.com", "t");
    expect(entry.size).toBe(MAX_INLINE_TEXT_BYTES + 1);
    expect(entry.text).toBeUndefined();
  });

  it("never inlines an image or a pdf", () => {
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "pic.png", mimeType: "image/png", bytes: Buffer.from("\x89PNG") });
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "d.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF") });
    for (const entry of listAttachments("a@x.com", "t")) expect(entry.text).toBeUndefined();
  });
});
