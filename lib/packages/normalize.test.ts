import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { normalizePackage, writeMeta, type UploadPart } from "./normalize";
import { packagesRoot, packageDir } from "./config";

// Fixed delete-list of every env var this module (or its config dependency)
// reads, restored in beforeEach/afterEach so tests never leak state (never
// vi.stubEnv, per repo convention).
const ENV_KEYS = ["PACKAGES_DATA_DIR", "PACKAGES_MAX_TOTAL_BYTES", "PACKAGES_MAX_FILE_BYTES", "PACKAGES_MAX_ENTRY_COUNT"];

let tmpRoot: string;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-normalize-"));
  process.env.PACKAGES_DATA_DIR = tmpRoot;
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function idRootExists(id: string): boolean {
  return fs.existsSync(path.dirname(packageDir(id)));
}

function readPackageFile(id: string, relPath: string): Buffer {
  return fs.readFileSync(path.join(packageDir(id), relPath));
}

function listPackageFiles(id: string): string[] {
  const dir = packageDir(id);
  const out: string[] = [];
  function walk(sub: string) {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const rel = path.posix.join(sub, entry.name);
      if (entry.isDirectory()) walk(rel);
      else out.push(rel);
    }
  }
  walk("");
  return out.sort();
}

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `test-id-${idCounter}`;
}

function zipBuffer(build: (zip: AdmZip) => void): Buffer {
  const zip = new AdmZip();
  build(zip);
  return zip.toBuffer();
}

const S_IFLNK_MODE = 0o120777; // symlink file type bits + rwxrwxrwx permissions

describe("normalizePackage: zip mode", () => {
  it("rejects a zip-slip entry (../ segment) and cleans up the partial dir", async () => {
    const id = freshId();
    // adm-zip's own `addFile` sanitizes `../` out of the name it's given
    // (via its internal `zipnamefix`), so the only way to build an archive
    // that actually CONTAINS a malicious raw entry name is to add a
    // placeholder entry, then overwrite its `entryName` directly (the
    // property setter itself does no sanitization) before serializing.
    const data = zipBuffer((zip) => {
      const entry = zip.addFile("placeholder.md", Buffer.from("pwned"));
      entry.entryName = "../evil.md";
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("evil.md");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects an absolute-path entry and cleans up the partial dir", async () => {
    const id = freshId();
    const data = zipBuffer((zip) => {
      const entry = zip.addFile("placeholder.md", Buffer.from("pwned"));
      entry.entryName = "/etc/passwd";
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("passwd");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects a symlink entry and cleans up the partial dir", async () => {
    const id = freshId();
    // `addFile`'s own `attr` parameter only keeps the low 12 permission
    // bits (it masks with 0xfff and hardcodes the S_IFREG/S_IFDIR type bits
    // itself), so it can never produce a real symlink entry. Setting
    // `entry.attr` directly afterward writes the full 32-bit external
    // attributes field unmasked, the same field `entry.header.attr` reads.
    const data = zipBuffer((zip) => {
      const entry = zip.addFile("link.md", Buffer.from("../../etc/passwd"));
      entry.attr = (S_IFLNK_MODE << 16) >>> 0;
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("link.md");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects an entry over the per-file byte cap and cleans up the partial dir", async () => {
    process.env.PACKAGES_MAX_FILE_BYTES = "10";
    const id = freshId();
    const data = zipBuffer((zip) => zip.addFile("big.md", Buffer.from("this is way more than ten bytes")));
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("big.md");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects a zip-bomb entry whose declared header size understates the real decompressed size", async () => {
    process.env.PACKAGES_MAX_FILE_BYTES = "1000";
    const id = freshId();
    const zip = new AdmZip();
    const bomb = Buffer.alloc(5000, "a"); // real size exceeds the 1000-byte cap
    const entry = zip.addFile("bomb.md", bomb);
    entry.header.size = 10; // lie: declared size is tiny
    const result = await normalizePackage([{ filename: "bundle.zip", data: zip.toBuffer() }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("bomb.md");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects a zip carrying two entries with the same name and cleans up the partial dir", async () => {
    const id = freshId();
    const data = zipBuffer((zip) => {
      zip.addFile("dup.md", Buffer.from("first"));
      const second = zip.addFile("other.md", Buffer.from("second"));
      second.entryName = "dup.md"; // nothing in the zip format forbids duplicate names
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("dup.md");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects a nested .zip entry (content policy) and cleans up the partial dir", async () => {
    const id = freshId();
    const inner = zipBuffer((zip) => zip.addFile("inner.md", Buffer.from("hi")));
    const data = zipBuffer((zip) => zip.addFile("nested.zip", inner));
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("nested.zip");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects a .docx entry (content policy)", async () => {
    const id = freshId();
    const data = zipBuffer((zip) => zip.addFile("report.docx", Buffer.from("binary-ish")));
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("report.docx");
    expect(idRootExists(id)).toBe(false);
  });

  it("accepts an image entry (.png) even though it's a KNOWN_BINARY_EXTENSION", async () => {
    const id = freshId();
    const data = zipBuffer((zip) => {
      zip.addFile("doc.md", Buffer.from("# hi"));
      zip.addFile("pic.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fileCount).toBe(2);
    expect(listPackageFiles(id)).toEqual(["doc.md", "pic.png"]);
  });

  it("flattens a single shared root directory and derives name from it", async () => {
    const id = freshId();
    const data = zipBuffer((zip) => {
      zip.addFile("HANDOFF_v11/README.md", Buffer.from("# readme"));
      zip.addFile("HANDOFF_v11/notes/notes.md", Buffer.from("notes"));
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("HANDOFF_v11");
      expect(result.fileCount).toBe(2);
    }
    expect(listPackageFiles(id)).toEqual(["README.md", "notes/notes.md"]);
  });

  it("does not flatten when entries don't share a single root, and derives name from the zip filename", async () => {
    const id = freshId();
    const data = zipBuffer((zip) => {
      zip.addFile("a/one.md", Buffer.from("one"));
      zip.addFile("b/two.md", Buffer.from("two"));
    });
    const result = await normalizePackage([{ filename: "MyBundle.zip", data }], id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe("MyBundle");
    expect(listPackageFiles(id)).toEqual(["a/one.md", "b/two.md"]);
  });

  it("caps a very long root directory name at 100 characters", async () => {
    const id = freshId();
    const longRoot = "A".repeat(250);
    const data = zipBuffer((zip) => {
      zip.addFile(`${longRoot}/README.md`, Buffer.from("# readme"));
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toHaveLength(100);
      expect(result.name).toBe("A".repeat(100));
    }
  });

  it("strips only the trailing .zip from a multi-dot zip filename when deriving the name", async () => {
    const id = freshId();
    const data = zipBuffer((zip) => {
      zip.addFile("a/one.md", Buffer.from("one"));
      zip.addFile("b/two.md", Buffer.from("two"));
    });
    const result = await normalizePackage([{ filename: "release-2.1.zip", data }], id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.name).toBe("release-2.1");
  });

  it("enforces the entry-count cap", async () => {
    process.env.PACKAGES_MAX_ENTRY_COUNT = "1";
    const id = freshId();
    const data = zipBuffer((zip) => {
      zip.addFile("one.md", Buffer.from("1"));
      zip.addFile("two.md", Buffer.from("2"));
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    expect(idRootExists(id)).toBe(false);
  });

  it("enforces the running total byte cap across entries", async () => {
    process.env.PACKAGES_MAX_TOTAL_BYTES = "10";
    const id = freshId();
    const data = zipBuffer((zip) => {
      zip.addFile("one.md", Buffer.from("123456"));
      zip.addFile("two.md", Buffer.from("789012"));
    });
    const result = await normalizePackage([{ filename: "bundle.zip", data }], id);
    expect(result.ok).toBe(false);
    expect(idRootExists(id)).toBe(false);
  });
});

describe("normalizePackage: loose files / non-zip", () => {
  it("accepts multiple loose files, sanitizing away any path components in their names", async () => {
    const id = freshId();
    const parts: UploadPart[] = [
      { filename: "../../evil/one.md", data: Buffer.from("one") },
      { filename: "sub/dir/two.md", data: Buffer.from("two") },
    ];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fileCount).toBe(2);
    expect(listPackageFiles(id)).toEqual(["one.md", "two.md"]);
    expect(readPackageFile(id, "one.md").toString()).toBe("one");
  });

  it("rejects two parts that sanitize to the same basename and cleans up the partial dir", async () => {
    const id = freshId();
    const parts: UploadPart[] = [
      { filename: "a/notes.md", data: Buffer.from("first") },
      { filename: "b/notes.md", data: Buffer.from("second") },
    ];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("notes.md");
    expect(idRootExists(id)).toBe(false);
  });

  it("accepts a single non-zip file and derives name from its filename minus extension", async () => {
    const id = freshId();
    const parts: UploadPart[] = [{ filename: "Design Doc.md", data: Buffer.from("content") }];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("Design Doc");
      expect(result.fileCount).toBe(1);
    }
  });

  it("rejects a .docx loose file (content policy) and cleans up the partial dir", async () => {
    const id = freshId();
    const parts: UploadPart[] = [
      { filename: "keep.md", data: Buffer.from("ok") },
      { filename: "reject.docx", data: Buffer.from("binary-ish") },
    ];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("reject.docx");
    expect(idRootExists(id)).toBe(false);
  });

  it("accepts an image loose file (.jpg)", async () => {
    const id = freshId();
    const parts: UploadPart[] = [
      { filename: "note.md", data: Buffer.from("note") },
      { filename: "photo.jpg", data: Buffer.from([0xff, 0xd8, 0xff]) },
    ];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fileCount).toBe(2);
  });

  it("rejects a loose file over the per-file byte cap and cleans up the partial dir", async () => {
    process.env.PACKAGES_MAX_FILE_BYTES = "5";
    const id = freshId();
    const parts: UploadPart[] = [{ filename: "big.md", data: Buffer.from("way too big for the cap") }];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("big.md");
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects when the file count exceeds the entry cap", async () => {
    process.env.PACKAGES_MAX_ENTRY_COUNT = "1";
    const id = freshId();
    const parts: UploadPart[] = [
      { filename: "one.md", data: Buffer.from("1") },
      { filename: "two.md", data: Buffer.from("2") },
    ];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(false);
    expect(idRootExists(id)).toBe(false);
  });

  it("rejects when no parts are provided", async () => {
    const id = freshId();
    const result = await normalizePackage([], id);
    expect(result.ok).toBe(false);
    expect(idRootExists(id)).toBe(false);
  });

  it("resolves to a rejection (never rejects the promise) for an unsafe id", async () => {
    const parts: UploadPart[] = [{ filename: "note.md", data: Buffer.from("note") }];
    const result = await normalizePackage(parts, "../escape");
    expect(result.ok).toBe(false);
  });
});

describe("writeMeta", () => {
  it("writes a meta.json file next to the package directory", async () => {
    const id = freshId();
    const parts: UploadPart[] = [{ filename: "note.md", data: Buffer.from("note") }];
    const result = await normalizePackage(parts, id);
    expect(result.ok).toBe(true);

    const receivedAt = new Date().toISOString();
    await writeMeta(id, {
      ownerEmail: "person@example.com",
      originalNames: ["note.md"],
      fileCount: 1,
      receivedAt,
    });

    const metaPath = path.join(packagesRoot(), id, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    expect(meta).toEqual({
      ownerEmail: "person@example.com",
      originalNames: ["note.md"],
      fileCount: 1,
      receivedAt,
    });
  });
});
