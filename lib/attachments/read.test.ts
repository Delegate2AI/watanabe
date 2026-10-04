import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storeAttachment, attachmentDirFor, attachmentsRoot } from "./store";
import { listAttachments } from "./read";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "attach-read-"));
  process.env.ATTACHMENTS_DIR = tmp;
  delete process.env.ATTACHMENTS_ENABLED;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.ATTACHMENTS_DIR;
  delete process.env.ATTACHMENTS_ENABLED;
});

describe("listAttachments, reads", () => {
  it("returns a text attachment's display name and content", () => {
    storeAttachment({
      ownerEmail: "alice@example.com",
      threadId: "t1",
      filename: "notes.md",
      mimeType: "text/markdown",
      bytes: Buffer.from("# hello\nworld"),
    });
    const out = listAttachments("alice@example.com", "t1");
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("notes.md");
    expect(out[0].text).toBe("# hello\nworld");
  });

  it("reads .txt and .markdown too", () => {
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "a.txt", mimeType: "text/plain", bytes: Buffer.from("plain") });
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t", filename: "b.markdown", mimeType: "text/markdown", bytes: Buffer.from("md") });
    const names = listAttachments("a@x.com", "t")
      .map((a) => a.name)
      .sort();
    expect(names).toEqual(["a.txt", "b.markdown"]);
  });
});

describe("listAttachments, cross-user / cross-thread isolation", () => {
  it("reads ONLY the authenticated owner's files, never another owner's", () => {
    storeAttachment({ ownerEmail: "alice@x.com", threadId: "shared", filename: "alice.txt", mimeType: "text/plain", bytes: Buffer.from("ALICE") });
    storeAttachment({ ownerEmail: "bob@x.com", threadId: "shared", filename: "bob.txt", mimeType: "text/plain", bytes: Buffer.from("BOB") });
    const alice = listAttachments("alice@x.com", "shared");
    expect(alice.map((a) => a.text)).toEqual(["ALICE"]);
    expect(alice.map((a) => a.text)).not.toContain("BOB");
  });

  it("reads ONLY the named thread's files, never a sibling thread's", () => {
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t1", filename: "one.txt", mimeType: "text/plain", bytes: Buffer.from("ONE") });
    storeAttachment({ ownerEmail: "a@x.com", threadId: "t2", filename: "two.txt", mimeType: "text/plain", bytes: Buffer.from("TWO") });
    expect(listAttachments("a@x.com", "t1").map((a) => a.text)).toEqual(["ONE"]);
    expect(listAttachments("a@x.com", "t2").map((a) => a.text)).toEqual(["TWO"]);
  });

  it("a traversal thread id is neutralized, never reaching a sibling thread's real dir", () => {
    storeAttachment({ ownerEmail: "a@x.com", threadId: "victim", filename: "secret.txt", mimeType: "text/plain", bytes: Buffer.from("SECRET") });
    const out = listAttachments("a@x.com", "../victim");
    expect(out).toEqual([]);
    expect(out.map((a) => a.text)).not.toContain("SECRET");
  });
});

describe("listAttachments, containment", () => {
  it("skips a symlink inside the dir that escapes to a file outside it", () => {
    const outside = path.join(tmp, "outside-secret.txt");
    fs.writeFileSync(outside, "OUTSIDE");
    const dir = attachmentDirFor("a@x.com", "t");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "real.txt"), "REAL");
    try {
      fs.symlinkSync(outside, path.join(dir, "escape.txt"));
    } catch {
      return;
    }
    const out = listAttachments("a@x.com", "t");
    expect(out.map((a) => a.text)).toEqual(["REAL"]);
    expect(out.map((a) => a.text)).not.toContain("OUTSIDE");
  });

  it("skips a directory entry that merely looks like a text file", () => {
    const dir = attachmentDirFor("a@x.com", "t");
    fs.mkdirSync(path.join(dir, "notafile.md"), { recursive: true });
    fs.writeFileSync(path.join(dir, "real.txt"), "REAL");
    const out = listAttachments("a@x.com", "t");
    expect(out.map((a) => a.name)).toEqual(["real.txt"]);
  });
});

describe("listAttachments, never throws", () => {
  it("returns [] for a thread that has no attachment dir at all", () => {
    expect(listAttachments("nobody@x.com", "never-uploaded")).toEqual([]);
  });

  it("returns [] (does not throw) when the dir path is unreadable", () => {
    const asFile = path.join(tmp, "not-a-dir");
    fs.writeFileSync(asFile, "x");
    process.env.ATTACHMENTS_DIR = asFile;
    expect(() => listAttachments("a@x.com", "t")).not.toThrow();
    expect(listAttachments("a@x.com", "t")).toEqual([]);
    expect(attachmentsRoot()).toContain("not-a-dir");
  });
});
