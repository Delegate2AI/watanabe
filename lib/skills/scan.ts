import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Bounded, symlink-refusing walk of a candidate skill folder.
 *
 * The content being walked is UNTRUSTED at this point: it has just come off a
 * git remote, a zip upload, or a marketplace, and nothing has vetted it yet.
 * So this walk is written to be hostile-input safe rather than convenient:
 *
 * - It is iterative with an explicit stack and a depth cap, so a pathologically
 *   nested tree cannot blow the JS stack.
 * - It refuses symlinks outright instead of following them, so nothing outside
 *   the folder can be stat'ed, read, or later handed to the SDK. `lstatSync` is
 *   used everywhere for the same reason.
 * - Caps are checked as entries are discovered, so an oversize or file-bombed
 *   folder is rejected before the walk finishes rather than after.
 *
 * `readdirSync(dir, { recursive: true })` would be shorter, but it materializes
 * the entire tree before any cap can be applied, which is the opposite of what
 * a cap is for.
 */
export type ScanFile = { rel: string; bytes: number; executable: boolean };

export type ScanResult = { ok: true; files: ScanFile[] } | { ok: false; reason: string };

export type ScanCaps = { maxBytes: number; maxFiles: number };

/** Directory nesting cap. Real skill folders are two or three levels deep. */
export const MAX_SKILL_DEPTH = 16;

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}

export function scanSkillDir(dir: string, caps: ScanCaps): ScanResult {
  let rootStat;
  try {
    rootStat = lstatSync(dir);
  } catch {
    return { ok: false, reason: `not a directory: ${dir}` };
  }
  if (rootStat.isSymbolicLink()) {
    return { ok: false, reason: "symlink: the skill directory is itself a symlink" };
  }
  if (!rootStat.isDirectory()) return { ok: false, reason: `not a directory: ${dir}` };

  const files: ScanFile[] = [];
  const stack: Array<{ abs: string; depth: number }> = [{ abs: dir, depth: 0 }];
  let entries = 0;
  let bytes = 0;

  while (stack.length > 0) {
    const current = stack.pop() as { abs: string; depth: number };
    if (current.depth > MAX_SKILL_DEPTH) {
      return { ok: false, reason: `nested too deeply: over ${MAX_SKILL_DEPTH} directory levels` };
    }

    let dirents;
    try {
      dirents = readdirSync(current.abs, { withFileTypes: true });
    } catch (error) {
      const rel = toPosix(path.relative(dir, current.abs)) || ".";
      return { ok: false, reason: `unreadable directory "${rel}": ${message(error)}` };
    }

    for (const dirent of dirents) {
      const abs = path.join(current.abs, dirent.name);
      const rel = toPosix(path.relative(dir, abs));

      // Directories count against the cap too, so a bomb made of a million
      // empty directories is rejected by the same budget as one made of files.
      entries += 1;
      if (entries > caps.maxFiles) {
        return { ok: false, reason: `too many files: over ${caps.maxFiles} entries` };
      }
      if (dirent.isSymbolicLink()) return { ok: false, reason: `symlink not allowed: "${rel}"` };
      if (dirent.isDirectory()) {
        stack.push({ abs, depth: current.depth + 1 });
        continue;
      }
      if (!dirent.isFile()) {
        return { ok: false, reason: `not a regular file: "${rel}"` };
      }

      let stat;
      try {
        stat = lstatSync(abs);
      } catch (error) {
        return { ok: false, reason: `unreadable file "${rel}": ${message(error)}` };
      }
      bytes += stat.size;
      if (bytes > caps.maxBytes) {
        return { ok: false, reason: `too large: over ${caps.maxBytes} bytes` };
      }
      files.push({ rel, bytes: stat.size, executable: (stat.mode & 0o111) !== 0 });
    }
  }

  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { ok: true, files };
}
