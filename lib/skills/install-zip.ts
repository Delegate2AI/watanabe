import { chmodSync, constants as fsConstants, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { MAX_SKILL_BYTES, MAX_SKILL_FILES } from "./validate";

/**
 * Zip fetch half of the skill install pipeline (spec 34).
 *
 * The bytes are an admin upload and are entirely untrusted. `extractAllTo` is
 * never used: adm-zip's convenience extractor has no zip-slip or symlink
 * protection and applies the archive's own file modes. Every entry is walked by
 * hand, checked, and written individually:
 *
 * - **Zip slip.** An entry name that is absolute or carries a `..` segment is
 *   refused before anything is written, and the resolved write target is
 *   lexically re-checked for containment in the extraction root.
 * - **Symlinks.** An entry whose external attributes carry `S_IFLNK` is
 *   refused. The validator rejects a skill folder containing any symlink, so
 *   extraction must not be the thing that plants one.
 * - **Bombs.** Entry count, declared total size, and real inflated size are all
 *   capped, and the declared total is checked before a single entry is
 *   inflated.
 * - **Modes.** Every file lands `0644` and every directory `0755`, regardless
 *   of what the archive claims. The validator reports a helper as a script
 *   partly by its executable bit, so an archive marking everything `0777` would
 *   otherwise flood the compat report the admin bases their trust decision on.
 *
 * Never throws: every rejection comes back as `{ ok: false, reason }`.
 */

export const SKILL_FILE_MODE = 0o644;
export const SKILL_DIR_MODE = 0o755;

/**
 * The best compression ratio DEFLATE can reach, about 1032:1 (a 258-byte match
 * encoded in roughly 2 bits). Used to bound what an entry that declares no
 * uncompressed size could possibly inflate to.
 */
export const MAX_DEFLATE_RATIO = 1032;

export type ZipCaps = { maxEntries: number; maxBytes: number };

export const DEFAULT_ZIP_CAPS: ZipCaps = { maxEntries: MAX_SKILL_FILES, maxBytes: MAX_SKILL_BYTES };

export type ZipExtractResult = { ok: true; files: number } | { ok: false; reason: string };

/** Thrown internally to short-circuit on any rejection; always caught by `extractSkillZip`. */
class RejectedZip extends Error {}

function reject(offendingName: string, reason: string): never {
  throw new RejectedZip(`rejected "${offendingName}": ${reason}`);
}

/** Zip entry names are POSIX by spec, but Windows tooling writes backslashes anyway. */
function toPosixEntryName(entryName: string): string {
  return entryName.replace(/\\/g, "/");
}

function assertSafeEntryPath(entryName: string): void {
  const posix = toPosixEntryName(entryName);
  if (path.posix.isAbsolute(posix) || path.win32.isAbsolute(entryName)) {
    reject(entryName, "absolute paths are not allowed");
  }
  if (posix.split("/").includes("..")) {
    reject(entryName, "path traversal (..) is not allowed");
  }
}

/** Lexical containment, the same technique as `isPathWithinVault`, applied to the write target. */
function assertContained(destDir: string, relPath: string, offendingName: string): void {
  const root = path.resolve(destDir);
  const target = path.resolve(root, relPath);
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    reject(offendingName, "path traversal: resolves outside the extraction directory");
  }
}

/** Unix `S_IFLNK`, packed into the zip's external attributes as `mode << 16`. */
function isSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  const mode = entry.header.attr >>> 16;
  return (mode & fsConstants.S_IFMT) === fsConstants.S_IFLNK;
}

function writeEntry(destDir: string, relPath: string, data: Buffer): void {
  const target = path.join(destDir, relPath);
  mkdirSync(path.dirname(target), { recursive: true, mode: SKILL_DIR_MODE });
  writeFileSync(target, data, { mode: SKILL_FILE_MODE });
  // `writeFileSync`'s mode is masked by the process umask and ignored entirely
  // when the file already exists, so pin it explicitly.
  chmodSync(target, SKILL_FILE_MODE);
}

/**
 * Validate and extract every entry of `data` into `destDir`. `destDir` must
 * already exist and must be empty; the caller owns it and removes it on any
 * failure, so a partial extraction is never observable.
 */
export function extractSkillZip(data: Buffer, destDir: string, caps: ZipCaps): ZipExtractResult {
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(data).getEntries();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `unreadable zip archive: ${message.replace(/\s+/g, " ").trim()}` };
  }

  try {
    if (entries.length > caps.maxEntries) {
      reject("archive", `holds ${entries.length} entries, over the ${caps.maxEntries} entry limit`);
    }
    // Structural checks cover directory entries too: a directory entry can
    // carry a traversal or symlink trick just as easily as a file entry.
    for (const entry of entries) {
      assertSafeEntryPath(entry.entryName);
      if (isSymlinkEntry(entry)) reject(entry.entryName, "symlink entries are not allowed");
    }

    const fileEntries = entries.filter((entry) => !entry.isDirectory);
    if (fileEntries.length === 0) reject("archive", "zip contains no files");

    let declared = 0;
    for (const entry of fileEntries) {
      // A declared uncompressed size of zero is the one value that turns
      // adm-zip's inflate bound OFF: it passes `expectedLength` through to
      // `zlib.inflateRawSync`'s `maxOutputLength` only when it is greater than
      // zero (adm-zip 0.5.18, methods/inflater.js). Such an entry also adds
      // nothing to the running total below, so it slips the budget and then
      // inflates with no ceiling, and adm-zip's eventual throw lands only AFTER
      // the whole payload has been materialized. A few hundred KB of upload
      // becomes a multi-GB allocation, which in a memory-limited container is
      // an OOM kill rather than a caught error.
      //
      // What is NOT a bomb is an empty file. Refusing every zero-size entry
      // that carries any compressed bytes was too blunt: adm-zip and Info-ZIP
      // store empty entries (compressedSize 0), but Python's `zipfile` with
      // ZIP_DEFLATED writes one as method 8 with compressedSize 2, so a
      // `.gitkeep` or `__init__.py` in a Python-built skill zip failed the
      // install with a security-flavored message and nothing wrong.
      //
      // Bound by ratio instead. Deflate cannot exceed roughly 1032:1, so an
      // entry with no declared ceiling can produce at most
      // `compressedSize * MAX_DEFLATE_RATIO` bytes. Refuse only when that worst
      // case would blow the archive budget. An empty entry's 2 bytes bound it
      // to about 2KB and pass; the bomb's tens of KB bound it to tens of MB and
      // do not.
      if (entry.header.size === 0 && entry.header.compressedSize * MAX_DEFLATE_RATIO > caps.maxBytes) {
        reject(
          entry.entryName,
          `declares no uncompressed size but could inflate to ${entry.header.compressedSize * MAX_DEFLATE_RATIO} bytes, over the ${caps.maxBytes} byte limit`,
        );
      }
      declared += entry.header.size;
      if (declared > caps.maxBytes) {
        reject(entry.entryName, `archive exceeds the ${caps.maxBytes} byte total limit`);
      }
    }

    const seen = new Set<string>();
    let inflated = 0;
    for (const entry of fileEntries) {
      const relPath = toPosixEntryName(entry.entryName);
      // Two entries with the same name is legal in the zip format and would
      // silently overwrite. Refuse rather than lose content.
      if (seen.has(relPath)) reject(entry.entryName, "duplicate entry name in archive");
      seen.add(relPath);
      assertContained(destDir, relPath, entry.entryName);

      // The header can lie about the inflated size (the classic bomb), so the
      // real bytes are re-checked. A header declaring LESS than the truth is
      // bounded by adm-zip: it hands the declared size to zlib as
      // `maxOutputLength`, which throws once that many bytes are produced. The
      // one value that disables that bound is zero, refused above.
      let bytes: Buffer;
      try {
        bytes = entry.getData();
      } catch {
        reject(entry.entryName, "could not be decompressed safely (possible zip bomb)");
      }
      inflated += bytes.length;
      if (inflated > caps.maxBytes) {
        reject(entry.entryName, `archive exceeds the ${caps.maxBytes} byte total limit`);
      }

      writeEntry(destDir, relPath, bytes);
    }

    return { ok: true, files: fileEntries.length };
  } catch (error) {
    if (error instanceof RejectedZip) return { ok: false, reason: error.message };
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `zip extraction failed: ${message.replace(/\s+/g, " ").trim()}` };
  }
}
