import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skillsStoreDir } from "./config";
import { installFromZip } from "./install";

/**
 * Zip install path. Most archives here are built in-process with adm-zip, so
 * the hostile shapes (zip slip, absolute entry, symlink entry, bomb, mode
 * mangling) are byte-exact rather than approximated, and nothing touches the
 * network. The empty-file case deliberately uses a fixture adm-zip did NOT
 * build: see `PYTHON_DEFLATED_ZIP_B64`.
 */
const ENV_KEYS = ["PORTAL_SKILLS_DIR"];

let tmpRoot: string;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skill-zip-"));
  process.env.PORTAL_SKILLS_DIR = path.join(tmpRoot, "store");
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** `addFile`'s own attr parameter masks to the low 12 bits and forces S_IFREG. */
const S_IFLNK_MODE = 0o120777;

/**
 * A skill zip written by Python, so the empty-file case is exercised against an
 * archive adm-zip did not produce. Regenerate with:
 *
 *   python3 -c "import zipfile,io,base64
 *   b=io.BytesIO()
 *   z=zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED)
 *   z.writestr('SKILL.md','---\nname: Brand Guidelines\ndescription: How we write.\n---\n\nBody.\n')
 *   z.writestr('references/.gitkeep','')
 *   z.close()
 *   print(base64.b64encode(b.getvalue()).decode())"
 */
const PYTHON_DEFLATED_ZIP_B64 = [
  "UEsDBBQAAAAIAOyB+Fz7owkmQgAAAEEAAAAIAAAAU0tJTEwubWTT1dXlykvMTbVScCpKzEtRcC/NTEnNycxLLeZKSS1OLsos",
  "KMnMz7NS8MgvVyhPVSgvyixJ1ePSBericspPqdTjAgBQSwMEFAAAAAgA7IH4XAAAAAACAAAAAAAAABMAAAByZWZlcmVuY2Vz",
  "Ly5naXRrZWVwAwBQSwECFAMUAAAACADsgfhc+6MJJkIAAABBAAAACAAAAAAAAAAAAAAAgAEAAAAAU0tJTEwubWRQSwECFAMU",
  "AAAACADsgfhcAAAAAAIAAAAAAAAAEwAAAAAAAAAAAAAAgAFoAAAAcmVmZXJlbmNlcy8uZ2l0a2VlcFBLBQYAAAAAAgACAHcA",
  "AACbAAAAAAA=",
].join("");

function zipBuffer(build: (zip: AdmZip) => void): Buffer {
  const zip = new AdmZip();
  build(zip);
  return zip.toBuffer();
}

function skillMd(name = "Brand Guidelines"): Buffer {
  return Buffer.from(["---", `name: ${name}`, "description: How we write.", "---", "", "Body.", ""].join("\n"));
}

function storeDir(slug: string): string {
  return path.join(skillsStoreDir(), slug);
}

describe("installFromZip", () => {
  it("lands a skill whose SKILL.md sits at the archive root", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      zip.addFile("references/style.md", Buffer.from("Style notes.\n"));
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slug).toBe("brand-guidelines");
    expect(result.source).toEqual({ type: "zip", filename: "brand.zip" });
    const dir = storeDir("brand-guidelines");
    expect(readFileSync(path.join(dir, "SKILL.md"), "utf8")).toContain("Brand Guidelines");
    expect(readFileSync(path.join(dir, "references", "style.md"), "utf8")).toContain("Style");
  });

  it("descends into a single wrapper directory, the shape a downloaded zip has", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("brand-guidelines/SKILL.md", skillMd());
      zip.addFile("brand-guidelines/references/style.md", Buffer.from("Style notes.\n"));
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(storeDir("brand-guidelines"), "SKILL.md"))).toBe(true);
  });

  it("strips directory components off an untrusted upload filename", async () => {
    const data = zipBuffer((zip) => zip.addFile("SKILL.md", skillMd()));

    const result = await installFromZip({ filename: "../../etc/brand.zip", data });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toEqual({ type: "zip", filename: "brand.zip" });
  });

  it("rejects a zip-slip entry (.. segment) and leaves no store directory", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      const entry = zip.addFile("placeholder.md", Buffer.from("pwned"));
      entry.entryName = "../evil.md";
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("traversal");
      expect(result.reason).toContain("evil.md");
    }
    expect(existsSync(path.join(tmpRoot, "evil.md"))).toBe(false);
    expect(existsSync(storeDir("brand-guidelines"))).toBe(false);
  });

  it("rejects an absolute-path entry", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      const entry = zip.addFile("placeholder.md", Buffer.from("pwned"));
      entry.entryName = "/etc/passwd";
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("passwd");
    expect(existsSync(storeDir("brand-guidelines"))).toBe(false);
  });

  it("rejects a symlink entry", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      const entry = zip.addFile("link.md", Buffer.from("../../etc/passwd"));
      entry.attr = (S_IFLNK_MODE << 16) >>> 0;
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("link.md");
  });

  it("rejects an archive over the injectable byte cap before extracting it", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      zip.addFile("big.md", Buffer.alloc(4096, 0x61));
    });

    const result = await installFromZip({ filename: "brand.zip", data }, { maxBytes: 1024 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("1024");
    expect(existsSync(storeDir("brand-guidelines"))).toBe(false);
  });

  it("rejects an archive over the injectable entry cap", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      for (let i = 0; i < 10; i += 1) zip.addFile(`note-${i}.md`, Buffer.from("x"));
    });

    const result = await installFromZip({ filename: "brand.zip", data }, { maxEntries: 4 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("4");
  });

  it("normalizes file modes so a mode-mangled archive cannot fake executables", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd(), "", 0o777);
      zip.addFile("references/style.md", Buffer.from("Style notes.\n"), "", 0o777);
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The validator reports a script partly by the executable mode bit, so an
    // archive claiming 0777 on every file must not turn plain markdown into a
    // pile of "scripts" in the admin's trust report.
    expect(result.validation.compat.scripts).toEqual([]);
    const mode = lstatSync(path.join(storeDir("brand-guidelines"), "references", "style.md")).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it("rejects an entry declaring zero uncompressed size while carrying compressed data", async () => {
    // The reviewer's compression-ratio bomb. adm-zip passes the declared size
    // to zlib as maxOutputLength only when it is greater than zero, so
    // declaring exactly 0 both slips under the pre-extraction byte budget (it
    // adds nothing to the total) and turns the only inflate bound off. The
    // entry below is a few tens of KB on the wire and inflates to 64MB, and
    // adm-zip would materialize all of it before throwing.
    const zip = new AdmZip();
    zip.addFile("SKILL.md", skillMd());
    zip.addFile("bomb.md", Buffer.alloc(64 * 1024 * 1024, 0x61));
    const staged = new AdmZip(zip.toBuffer());
    for (const entry of staged.getEntries()) {
      if (entry.entryName === "bomb.md") entry.header.size = 0;
    }
    const data = staged.toBuffer();
    expect(data.length).toBeLessThan(200_000);

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("bomb.md");
      expect(result.reason).toContain("could inflate to");
    }
    expect(existsSync(storeDir("brand-guidelines"))).toBe(false);
  });

  it("still accepts a genuinely empty file, which compresses to nothing", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      zip.addFile("placeholder.txt", Buffer.alloc(0));
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(storeDir("brand-guidelines"), "placeholder.txt"))).toBe(true);
  });

  it("accepts an empty file in an archive not built by adm-zip", async () => {
    // Deliberately NOT built with adm-zip. adm-zip and Info-ZIP STORE an empty
    // entry (compressedSize 0), and building the fixture with the same library
    // the code reads it with is what hid this: Python's zipfile with
    // ZIP_DEFLATED writes an empty file as method 8 with compressedSize 2, so a
    // rule of "size 0 plus any compressed bytes is a bomb" failed every
    // .gitkeep, __init__.py, and placeholder in a Python-built skill zip.
    const data = Buffer.from(PYTHON_DEFLATED_ZIP_B64, "base64");
    const gitkeep = new AdmZip(data).getEntries().find((e) => e.entryName === "references/.gitkeep");
    expect(gitkeep?.header.method).toBe(8);
    expect(gitkeep?.header.size).toBe(0);
    expect(gitkeep?.header.compressedSize).toBe(2);

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(true);
    expect(existsSync(path.join(storeDir("brand-guidelines"), "references", ".gitkeep"))).toBe(true);
  });

  it("rejects a duplicate entry name rather than silently overwriting", async () => {
    const data = zipBuffer((zip) => {
      zip.addFile("SKILL.md", skillMd());
      const entry = zip.addFile("placeholder.md", Buffer.from("second"));
      entry.entryName = "SKILL.md";
    });

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("duplicate");
  });

  it("returns a reason rather than throwing on bytes that are not a zip", async () => {
    const result = await installFromZip({ filename: "brand.zip", data: Buffer.from("not a zip at all") });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it("rejects an archive with no SKILL.md and leaves nothing behind", async () => {
    const data = zipBuffer((zip) => zip.addFile("readme.md", Buffer.from("nothing to see")));

    const result = await installFromZip({ filename: "brand.zip", data });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("SKILL.md");
    expect(readdirSync(tmpRoot).filter((name) => name.startsWith(".skill-install-"))).toEqual([]);
  });
});
