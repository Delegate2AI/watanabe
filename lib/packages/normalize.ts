import { constants as fsConstants } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { KNOWN_BINARY_EXTENSIONS } from "@/lib/kb-mcp/tools";
import { packageDir, maxEntryCount, maxFileBytes, maxTotalBytes } from "./config";

/**
 * Package intake: lands untrusted uploaded bytes (a single zip, or a batch of
 * loose files) into `<packagesRoot()>/<id>/package/` on disk, for a later
 * background job to fold into the knowledge base. Every rejection path
 * (zip-slip, symlink, oversized content, disallowed extension, ...) removes
 * the ENTIRE `<packagesRoot()>/<id>/` directory before returning, so a
 * rejected upload never leaves partial content behind for a retry (or a
 * different id reuse) to trip over.
 *
 * Zip entries are NEVER extracted with `extractAllTo` (adm-zip's own
 * convenience method has no zip-slip/symlink protection): every entry is
 * walked by hand via `getEntries()`, validated, and written individually.
 */

export type UploadPart = { filename: string; data: Buffer };

export type NormalizeResult = { ok: true; name: string; fileCount: number } | { ok: false; error: string };

/** Image extensions allowed through the content policy even though they're in `KNOWN_BINARY_EXTENSIONS`. */
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** Only characters safe for a human-facing package name derived from untrusted zip/file names. */
const NAME_CHARSET = /[^A-Za-z0-9._ -]/g;

/** Cap on a sanitized package name's length: an untrusted zip root-dir name (up to 64KB per the zip format) otherwise flows straight into the DB `name`, the MR title, the archive directory, and the branch slug, several of which fail late/ugly on something that long. */
const MAX_NAME_LENGTH = 100;

function sanitizeName(raw: string): string {
  const cleaned = raw.replace(NAME_CHARSET, "_").trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || "package";
}

/** True when `filename`'s extension is allowed by the content policy: not a known binary type, or an allowed image type. */
function isAllowedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (!KNOWN_BINARY_EXTENSIONS.has(ext)) return true;
  return ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

/** Strips any directory components a client-supplied filename might carry, on either separator style. */
function sanitizeBasename(filename: string): string {
  const normalized = filename.replace(/\\/g, "/");
  return path.posix.basename(normalized);
}

function stripExt(filename: string): string {
  return filename.slice(0, filename.length - path.extname(filename).length);
}

/** Thrown internally to short-circuit processing on any rejection; always caught by `normalizePackage`. */
class RejectedUpload extends Error {}

function reject(offendingName: string, reason: string): never {
  throw new RejectedUpload(`rejected "${offendingName}": ${reason}`);
}

/** Absolute paths and `..` segments are refused outright, before any lexical-containment check even runs. */
function assertSafeEntryPath(entryName: string): void {
  if (entryName.startsWith("/") || path.win32.isAbsolute(entryName) || path.posix.isAbsolute(entryName)) {
    reject(entryName, "absolute paths are not allowed");
  }
  const segments = entryName.split(/[\\/]/);
  if (segments.includes("..")) {
    reject(entryName, "path traversal (..) is not allowed");
  }
}

/** Lexical containment check: the resolved write target must still be inside `destDir`, even after the checks above. */
function assertContained(destDir: string, relPath: string, offendingName: string): void {
  const destResolved = path.resolve(destDir);
  const target = path.resolve(destDir, relPath);
  if (target !== destResolved && !target.startsWith(destResolved + path.sep)) {
    reject(offendingName, "resolves outside the package directory");
  }
}

/** Unix `S_IFLNK` bit, packed into the zip's external file attributes as `mode << 16` (adm-zip's `header.attr`). */
function isSymlinkEntry(entry: AdmZip.IZipEntry): boolean {
  const mode = entry.header.attr >>> 16;
  return (mode & fsConstants.S_IFMT) === fsConstants.S_IFLNK;
}

async function writeEntryFile(destDir: string, relPath: string, data: Buffer): Promise<void> {
  const target = path.join(destDir, relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}

/**
 * Whether every file entry in a zip sits under one shared top-level
 * directory (e.g. `HANDOFF_v11/README.md`, `HANDOFF_v11/notes/notes.md`).
 * When it does, that directory's contents become the package root and its
 * (sanitized) name becomes the package's `name`: a very common shape for
 * hand-zipped doc bundles, where the zip itself is just a wrapper around one
 * named folder.
 */
function detectSingleRoot(fileEntries: AdmZip.IZipEntry[]): string | null {
  let root: string | null = null;
  for (const entry of fileEntries) {
    const segments = entry.entryName.split("/");
    if (segments.length < 2 || segments[0] === "") return null;
    if (root === null) root = segments[0];
    else if (root !== segments[0]) return null;
  }
  return root;
}

/**
 * Validate and land every entry of a single uploaded zip into `destDir`.
 * Entries are walked and validated one at a time, writing each as soon as it
 * passes every check (rather than validating the whole archive up front,
 * then writing), so a zip-bomb entry discovered partway through still leaves
 * earlier, valid entries written to disk, but that's fine: the caller always
 * removes the whole `<id>/` directory on any rejection, so a partial write
 * here is never observable as a partial package.
 */
async function normalizeZip(zipPart: UploadPart, destDir: string): Promise<{ name: string; fileCount: number }> {
  const zip = new AdmZip(zipPart.data);
  const entries = zip.getEntries();

  // Structural safety checks apply to every entry (files AND directories):
  // a directory entry can carry a zip-slip or symlink trick just as easily
  // as a file entry, even though only file entries are ever written.
  for (const entry of entries) {
    assertSafeEntryPath(entry.entryName);
    if (isSymlinkEntry(entry)) reject(entry.entryName, "symlink entries are not allowed");
  }

  const fileEntries = entries.filter((e) => !e.isDirectory);
  if (fileEntries.length === 0) {
    reject(zipPart.filename, "zip contains no files");
  }
  if (fileEntries.length > maxEntryCount()) {
    reject(zipPart.filename, `contains ${fileEntries.length} entries, exceeding the ${maxEntryCount()} limit`);
  }

  const rootDir = detectSingleRoot(fileEntries);
  // Strip ONLY the trailing `.zip`, never a second extension-looking suffix:
  // `release-2.1.zip` must derive `release-2.1`, not `release-2` (stripExt on
  // top of the .zip removal would eat the `.1` too).
  const zipBaseName = sanitizeBasename(zipPart.filename).replace(/\.zip$/i, "");
  const name = rootDir ? sanitizeName(rootDir) : sanitizeName(zipBaseName);

  const cap = maxFileBytes();
  const totalCap = maxTotalBytes();
  const seenPaths = new Set<string>();
  let declaredTotal = 0;
  let actualTotal = 0;
  let fileCount = 0;

  for (const entry of fileEntries) {
    // A crafted zip can carry two entries with the SAME name (nothing in the
    // format forbids it); writing both would silently overwrite the first,
    // same class of bug as the loose-file basename collision below. Reject.
    if (seenPaths.has(entry.entryName)) {
      reject(entry.entryName, "duplicate entry name in archive");
    }
    seenPaths.add(entry.entryName);

    if (!isAllowedExtension(entry.entryName)) {
      reject(entry.entryName, "file type not allowed");
    }

    if (entry.header.size > cap) {
      reject(entry.entryName, `declared size exceeds the ${cap} byte per-file limit`);
    }
    declaredTotal += entry.header.size;
    if (declaredTotal > totalCap) {
      reject(entry.entryName, `declared package size exceeds the ${totalCap} byte total limit`);
    }

    // The header can lie (a classic zip-bomb: a declared size far smaller
    // than what the entry actually inflates to), so re-check against the
    // REAL bytes rather than trusting `header.size`. adm-zip itself refuses to
    // inflate an entry past its OWN declared size (it throws rather than
    // silently returning oversized/truncated data), so a lying header
    // surfaces here as a thrown error, not as an oversized `data.length`;
    // either way it's caught and reported against this entry's name.
    let data: Buffer;
    try {
      data = entry.getData();
    } catch {
      reject(entry.entryName, "could not be decompressed safely (possible zip bomb)");
    }
    if (data.length > cap) {
      reject(entry.entryName, `decompressed size exceeds the ${cap} byte per-file limit`);
    }
    actualTotal += data.length;
    if (actualTotal > totalCap) {
      reject(entry.entryName, `decompressed package size exceeds the ${totalCap} byte total limit`);
    }

    const relPath = rootDir ? entry.entryName.slice(rootDir.length + 1) : entry.entryName;
    assertContained(destDir, relPath, entry.entryName);

    await writeEntryFile(destDir, relPath, data);
    fileCount += 1;
  }

  return { name, fileCount };
}

async function normalizeLoose(parts: UploadPart[], destDir: string): Promise<{ name: string; fileCount: number }> {
  if (parts.length > maxEntryCount()) {
    reject(`${parts.length} files`, `exceeds the ${maxEntryCount()} entry limit`);
  }

  const cap = maxFileBytes();
  const totalCap = maxTotalBytes();
  const seenBases = new Set<string>();
  let total = 0;
  let firstBase: string | null = null;
  let fileCount = 0;

  for (const part of parts) {
    const base = sanitizeBasename(part.filename);
    if (!base || base === "." || base === "..") {
      reject(part.filename, "invalid filename");
    }
    // Loose files all land flat in destDir under their sanitized basenames,
    // so two parts collapsing to the same basename would mean the second
    // silently overwrites the first. Reject instead: a lost file is worse
    // than a rejected upload the user can fix by renaming.
    if (seenBases.has(base)) {
      reject(part.filename, `duplicate filename "${base}" after sanitization`);
    }
    seenBases.add(base);
    if (firstBase === null) firstBase = base;

    if (!isAllowedExtension(base)) {
      reject(part.filename, "file type not allowed");
    }
    if (part.data.length > cap) {
      reject(part.filename, `exceeds the ${cap} byte per-file limit`);
    }
    total += part.data.length;
    if (total > totalCap) {
      reject(part.filename, `package exceeds the ${totalCap} byte total limit`);
    }

    await writeEntryFile(destDir, base, part.data);
    fileCount += 1;
  }

  const name = sanitizeName(stripExt(firstBase ?? "package"));
  return { name, fileCount };
}

/**
 * Normalize an upload (a single zip, or one-or-more loose files) into
 * `<packagesRoot()>/<id>/package/`. `id` is trusted to already be a
 * `crypto.randomUUID()` (validated again by `packageDir` regardless).
 *
 * Mode selection: exactly one part whose filename ends in `.zip` is treated
 * as a zip archive to unpack; anything else (multiple parts, or a single
 * non-zip part) is treated as loose files, sanitized to their basenames.
 */
export async function normalizePackage(parts: UploadPart[], id: string): Promise<NormalizeResult> {
  // `packageDir` throws for an unsafe id (defense in depth: `id` is trusted
  // to already be a `crypto.randomUUID()` from the caller). Nothing has been
  // written to disk yet at this point, so a bad id just short-circuits
  // straight to a `NormalizeResult` with no cleanup needed, rather than
  // rejecting the promise.
  let destDir: string;
  try {
    destDir = packageDir(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
  const idRoot = path.dirname(destDir);

  try {
    if (parts.length === 0) {
      reject("upload", "no files provided");
    }

    const isZipMode = parts.length === 1 && parts[0].filename.toLowerCase().endsWith(".zip");

    await mkdir(destDir, { recursive: true });

    if (isZipMode) {
      const { name, fileCount } = await normalizeZip(parts[0], destDir);
      return { ok: true, name, fileCount };
    }

    const { name, fileCount } = await normalizeLoose(parts, destDir);
    return { ok: true, name, fileCount };
  } catch (err) {
    await rm(idRoot, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Write `meta.json` alongside the package directory
 * (`<packagesRoot()>/<id>/meta.json`), recording who uploaded it, what the
 * original (pre-sanitization) filenames were, and when. Read later by the
 * background integration job.
 */
export async function writeMeta(
  id: string,
  meta: { ownerEmail: string; originalNames: string[]; fileCount: number; receivedAt: string },
): Promise<void> {
  const idRoot = path.dirname(packageDir(id));
  await mkdir(idRoot, { recursive: true });
  await writeFile(path.join(idRoot, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
}
