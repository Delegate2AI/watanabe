import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isAttachmentsEnabled,
  validateAttachment,
  storeAttachment,
  attachmentDirFor,
  attachmentsRoot,
  ownerKey,
  ALLOWED_ATTACHMENT_TYPES,
} from "./store";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "attach-"));
  process.env.ATTACHMENTS_DIR = tmp;
  delete process.env.ATTACHMENTS_ENABLED;
  delete process.env.ATTACHMENTS_MAX_BYTES;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ATTACHMENTS_DIR;
  delete process.env.ATTACHMENTS_ENABLED;
  delete process.env.ATTACHMENTS_MAX_BYTES;
});

describe("isAttachmentsEnabled", () => {
  it("is off by default and on only for exactly '1'", () => {
    expect(isAttachmentsEnabled()).toBe(false);
    process.env.ATTACHMENTS_ENABLED = "1";
    expect(isAttachmentsEnabled()).toBe(true);
    process.env.ATTACHMENTS_ENABLED = "true";
    expect(isAttachmentsEnabled()).toBe(false);
  });
});

describe("validateAttachment", () => {
  it("accepts an allow-listed type within the size cap", () => {
    expect(validateAttachment({ mimeType: "image/png", size: 1000 })).toEqual({ ok: true });
  });
  it("rejects an unsupported type", () => {
    const r = validateAttachment({ mimeType: "application/x-msdownload", size: 10 });
    expect(r.ok).toBe(false);
  });
  it("rejects an over-cap file", () => {
    process.env.ATTACHMENTS_MAX_BYTES = "100";
    const r = validateAttachment({ mimeType: "text/plain", size: 200 });
    expect(r.ok).toBe(false);
  });
  it("rejects an empty file", () => {
    expect(validateAttachment({ mimeType: "text/plain", size: 0 }).ok).toBe(false);
  });
});

describe("storeAttachment", () => {
  it("writes under <root>/<owner-slug>/<thread>/ and returns a chip", () => {
    const chip = storeAttachment({
      ownerEmail: "Alice@Example.com",
      threadId: "t1",
      filename: "notes.md",
      mimeType: "text/markdown",
      bytes: Buffer.from("# hello"),
    });
    expect(chip).toMatchObject({ type: "attachment", name: "notes.md", mimeType: "text/markdown", threadId: "t1" });
    const dir = attachmentDirFor("Alice@Example.com", "t1");
    expect(dir.startsWith(attachmentsRoot())).toBe(true);
    // The owner segment is a hex hash of the raw email, not a lossy slug.
    expect(dir).toContain(ownerKey("Alice@Example.com"));
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0].endsWith("-notes.md")).toBe(true);
  });

  it("gives collision-prone emails DISTINCT owner keys (no slug collision)", () => {
    // Both of these would slug to the same folder under a naive emailSlug.
    expect(ownerKey("a.b@x.com")).not.toBe(ownerKey("a-b@x.com"));
    expect(attachmentDirFor("a.b@x.com", "t")).not.toBe(attachmentDirFor("a-b@x.com", "t"));
  });

  it("isolates two owners' uploads by their identity slug, never by client input", () => {
    storeAttachment({ ownerEmail: "a@x.com", threadId: "shared", filename: "f", mimeType: "text/plain", bytes: Buffer.from("a") });
    storeAttachment({ ownerEmail: "b@x.com", threadId: "shared", filename: "f", mimeType: "text/plain", bytes: Buffer.from("b") });
    // Even with the SAME threadId, the two land under different owner slugs.
    expect(fs.readdirSync(attachmentDirFor("a@x.com", "shared"))).toHaveLength(1);
    expect(fs.readdirSync(attachmentDirFor("b@x.com", "shared"))).toHaveLength(1);
  });

  it("neutralizes path-traversal in the thread id and filename", () => {
    const chip = storeAttachment({
      ownerEmail: "a@x.com",
      threadId: "../../etc",
      filename: "../../../evil.sh",
      mimeType: "text/plain",
      bytes: Buffer.from("x"),
    });
    const dir = attachmentDirFor("a@x.com", "../../etc");
    // The resolved dir stays under the attachments root, never escaping it.
    expect(path.resolve(dir).startsWith(path.resolve(attachmentsRoot()))).toBe(true);
    expect(chip.name).not.toContain("/");
  });

  it("never stores under the KB vault (does not widen clearance)", () => {
    const chip = storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "f.txt", mimeType: "text/plain", bytes: Buffer.from("x") });
    expect(attachmentDirFor("a@x.com", "t")).toContain(tmp);
    expect(chip).not.toHaveProperty("path");
  });

  it("exposes the first-class allowed types (images + text/markdown/pdf)", () => {
    expect(ALLOWED_ATTACHMENT_TYPES).toContain("image/png");
    expect(ALLOWED_ATTACHMENT_TYPES).toContain("text/markdown");
    expect(ALLOWED_ATTACHMENT_TYPES).toContain("application/pdf");
  });
});

describe("validateAttachment, csv and json", () => {
  it("accepts text/csv and application/json outright", () => {
    expect(validateAttachment({ mimeType: "text/csv", size: 10 })).toEqual({ ok: true });
    expect(validateAttachment({ mimeType: "application/json", size: 10 })).toEqual({ ok: true });
  });

  it("accepts an empty or generic mime when the extension is a known text one", () => {
    for (const mimeType of ["", "application/octet-stream"]) {
      for (const filename of ["rows.csv", "cfg.JSON", "notes.md", "a.txt"]) {
        expect(validateAttachment({ mimeType, size: 10, filename })).toEqual({ ok: true });
      }
    }
  });

  it("still refuses a binary mime that merely carries a .csv name", () => {
    const result = validateAttachment({ mimeType: "application/x-msdownload", size: 10, filename: "payload.csv" });
    expect(result.ok).toBe(false);
  });

  it("still refuses a generic mime with an extension that is not text", () => {
    const result = validateAttachment({ mimeType: "application/octet-stream", size: 10, filename: "payload.exe" });
    expect(result.ok).toBe(false);
  });

  it("still refuses a generic mime with no filename at all", () => {
    expect(validateAttachment({ mimeType: "application/octet-stream", size: 10 }).ok).toBe(false);
  });

  it("keeps refusing an over-cap csv", () => {
    process.env.ATTACHMENTS_MAX_BYTES = "100";
    expect(validateAttachment({ mimeType: "text/csv", size: 101 }).ok).toBe(false);
    delete process.env.ATTACHMENTS_MAX_BYTES;
  });
});
