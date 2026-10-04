import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRender, writeRender, rendersRoot, renderDirFor } from "./store";

/**
 * Where a rendered file lives
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * The isolation boundary is the path, and it is a SHA-256 of the raw owner
 * email, exactly as `lib/attachments/store.ts` does it and for the same reason:
 * a slug collapses `a.b@x.com` and `a-b@x.com` onto one directory, which would
 * put one person's documents in another person's folder.
 */

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "renders-"));
  process.env.DOC_RENDERS_DIR = root;
});

afterEach(() => {
  delete process.env.DOC_RENDERS_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

const ALICE = "alice@example.com";

describe("render store", () => {
  it("round-trips a stored file", () => {
    writeRender({ ownerEmail: ALICE, docId: "d1", version: 2, kind: "pdf", bytes: Buffer.from("%PDF-1.4") });
    expect(readRender({ ownerEmail: ALICE, docId: "d1", version: 2, kind: "pdf" })?.toString()).toBe("%PDF-1.4");
  });

  it("keeps versions apart, so an older version keeps its own files", () => {
    writeRender({ ownerEmail: ALICE, docId: "d1", version: 1, kind: "md", bytes: Buffer.from("v1") });
    writeRender({ ownerEmail: ALICE, docId: "d1", version: 2, kind: "md", bytes: Buffer.from("v2") });

    expect(readRender({ ownerEmail: ALICE, docId: "d1", version: 1, kind: "md" })?.toString()).toBe("v1");
    expect(readRender({ ownerEmail: ALICE, docId: "d1", version: 2, kind: "md" })?.toString()).toBe("v2");
  });

  it("returns null for a file that was never rendered, rather than throwing", () => {
    expect(readRender({ ownerEmail: ALICE, docId: "nope", version: 1, kind: "pdf" })).toBeNull();
  });

  it("separates two owners whose emails would slug to the same folder", () => {
    const a = renderDirFor("a.b@example.com", "d1");
    const b = renderDirFor("a-b@example.com", "d1");
    expect(a).not.toBe(b);
  });

  it("keeps two ids apart that a pure sanitize would map onto one folder", () => {
    // `a/b` and `a?b` both sanitize to `a-b`. Without a hash in the segment the
    // second document's bytes came back for the first.
    writeRender({ ownerEmail: ALICE, docId: "a/b", version: 1, kind: "md", bytes: Buffer.from("first") });
    writeRender({ ownerEmail: ALICE, docId: "a?b", version: 1, kind: "md", bytes: Buffer.from("second") });

    expect(readRender({ ownerEmail: ALICE, docId: "a/b", version: 1, kind: "md" })?.toString()).toBe("first");
    expect(readRender({ ownerEmail: ALICE, docId: "a?b", version: 1, kind: "md" })?.toString()).toBe("second");
  });

  it("keeps two ids apart that share a long prefix, which truncation would merge", () => {
    const prefix = "x".repeat(200);
    writeRender({ ownerEmail: ALICE, docId: `${prefix}1`, version: 1, kind: "md", bytes: Buffer.from("one") });
    writeRender({ ownerEmail: ALICE, docId: `${prefix}2`, version: 1, kind: "md", bytes: Buffer.from("two") });

    expect(readRender({ ownerEmail: ALICE, docId: `${prefix}1`, version: 1, kind: "md" })?.toString()).toBe("one");
    expect(readRender({ ownerEmail: ALICE, docId: `${prefix}2`, version: 1, kind: "md" })?.toString()).toBe("two");
  });

  it("never lets a document id climb out of the owner's directory", () => {
    const dir = renderDirFor(ALICE, "../../etc");
    expect(dir.startsWith(path.join(rendersRoot(), ""))).toBe(true);
    expect(dir).not.toContain("..");
  });

  it("does not put the owner's email anywhere in the path", () => {
    expect(renderDirFor(ALICE, "d1")).not.toContain("alice");
    expect(renderDirFor(ALICE, "d1")).not.toContain("example.com");
  });

  it("overwrites a re-render of the same version rather than accumulating copies", () => {
    writeRender({ ownerEmail: ALICE, docId: "d1", version: 1, kind: "html", bytes: Buffer.from("first") });
    writeRender({ ownerEmail: ALICE, docId: "d1", version: 1, kind: "html", bytes: Buffer.from("second") });

    expect(readRender({ ownerEmail: ALICE, docId: "d1", version: 1, kind: "html" })?.toString()).toBe("second");
    expect(fs.readdirSync(renderDirFor(ALICE, "d1"))).toEqual(["v1.html"]);
  });

  it("reports a write it could not perform instead of pretending it landed", () => {
    // A root that is a regular file, so mkdir fails with ENOTDIR on every
    // platform. A path under /proc does NOT work here: procfs answers mkdir
    // with ENOENT, which node's recursive mkdir reads as "the parent is
    // missing", and since the parent always exists it retries forever.
    const blocked = path.join(root, "not-a-directory");
    fs.writeFileSync(blocked, "");
    process.env.DOC_RENDERS_DIR = blocked;
    expect(
      writeRender({ ownerEmail: ALICE, docId: "d1", version: 1, kind: "pdf", bytes: Buffer.from("x") }),
    ).toBe(false);
  });
});
