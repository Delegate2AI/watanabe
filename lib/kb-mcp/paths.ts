import { realpathSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { vaultRoot } from "@/lib/repo";
import { isPathWithinVault } from "@/lib/agent/permissions";
import { IGNORED_PATTERNS, SYSTEM_WRITE_DENY, SYSTEM_WRITE_DENY_REASON } from "./constants";

/**
 * Path resolution and result shapes for the vault tools: the extension
 * classification, the two MCP result helpers, and the containment plus
 * deny-list checks every tool routes through before it touches the disk.
 *
 * Its own module so `tools.ts` holds the three read tools and nothing else.
 */

/**
 * File extensions `kb_read` treats as text without needing to sniff content.
 * Exported for reuse by `lib/kb-mcp/write-tools.ts`'s `kb_stage_edit`, which
 * applies the identical text/binary classification to what it's asked to write.
 */
export const KNOWN_TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".canvas",
  ".base",
  ".csv",
  ".js",
  ".ts",
  ".css",
  ".html",
  ".xml",
]);

/**
 * File extensions `kb_read` refuses outright, without opening the file.
 * Exported for reuse by `lib/kb-mcp/write-tools.ts` (`kb_stage_edit` refuses to
 * write these same extensions, for the same reason: this KB is a plain-text
 * vault, not a binary asset store).
 */
export const KNOWN_BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".xlsx",
  ".xls",
  ".docx",
  ".pptx",
  ".mp3",
  ".mp4",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".sqlite",
  ".sqlite3",
  ".db",
]);

/** Exported for reuse by `lib/kb-mcp/write-tools.ts`: the same plain-text MCP result shape. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** Normalize to forward slashes so pattern matching is OS-independent. */
export function toPosix(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

/**
 * True when `relFromVaultRoot` (already relative, POSIX-normalized) falls
 * under one of `IGNORED_PATTERNS`: either an exact/prefix match against a
 * nested pattern (`assets/data` matches itself and everything under it), or
 * any path SEGMENT matching a bare directory-name pattern (`.git` matches
 * `.git` at the root, `sub/.git`, etc.).
 */
export function isIgnoredRelPath(relFromVaultRoot: string): boolean {
  const norm = toPosix(relFromVaultRoot);
  const segments = norm.split("/").filter(Boolean);
  for (const pattern of IGNORED_PATTERNS) {
    if (pattern.includes("/")) {
      if (norm === pattern || norm.startsWith(`${pattern}/`)) return true;
    } else if (segments.includes(pattern)) {
      return true;
    }
  }
  return false;
}

export type ResolveOk = { ok: true; abs: string; root: string; relInput: string };
export type ResolveErr = { ok: false; result: CallToolResult };

/**
 * Resolve a caller-supplied relative path against an arbitrary vault-shaped
 * `root` and verify containment BEFORE any filesystem access. This is the one
 * place every tool handler below must route through first.
 *
 * Checks BOTH containment (`isPathWithinVault`) AND the ignore list
 * (`isIgnoredRelPath`), not just containment. `kbList`/`kbSearch` already
 * filter `IGNORED_PATTERNS` out of directory walks, but that alone doesn't
 * stop a caller from passing an ignored path (e.g. `.obsidian/app.json`)
 * directly as the `path`/`path` argument itself, which skips the walk
 * entirely. Doing the ignore check here, once, closes that gap for all three
 * tools instead of requiring each call site to remember it.
 *
 * Generalized to take `root` explicitly (rather than always calling
 * `vaultRoot()`) so the write-path staging tools (`lib/kb-mcp/write-tools.ts`)
 * can reuse the identical containment + ignore-list logic against a per-thread
 * git worktree's vault subdirectory instead of the read-serving `vaultRoot()`.
 */
export function resolveInRoot(relPath: string, root: string): ResolveOk | ResolveErr {
  const relInput = relPath.trim() === "" ? "." : relPath;
  const abs = path.resolve(root, relInput);
  if (!isPathWithinVault(abs, root)) {
    return {
      ok: false,
      result: errorResult(
        `Path "${relPath}" resolves outside the knowledge-base vault, refusing to access it.`,
      ),
    };
  }
  const relFromRoot = path.relative(root, abs);
  if (relFromRoot !== "" && isIgnoredRelPath(relFromRoot)) {
    return {
      ok: false,
      result: errorResult(
        `Path "${relPath}" is inside an ignored area of the knowledge-base vault, refusing to access it.`,
      ),
    };
  }
  return { ok: true, abs, root, relInput };
}

/**
 * The deepest existing ancestor of `abs`, with every symlink followed.
 *
 * `resolveInRoot` is lexical, which is enough for a read but not for a write:
 * `alias/x.md` where `alias` links to `meetings` resolves to an ordinary path
 * and the write then follows the link. The file itself usually does not exist
 * yet, so the walk stops at the first ancestor that does.
 */
function realAncestor(abs: string): string {
  let current = abs;
  for (;;) {
    try {
      return path.join(realpathSync(current), path.relative(current, abs));
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return abs;
      current = parent;
    }
  }
}

/**
 * `resolveInRoot` plus the system-owned check: the one place every WRITE tool
 * routes through, where `resolveInRoot` is what the read tools use.
 *
 * Matched on real, case-folded path segments. A deny entry names a folder, not
 * a spelling of one and not one route to it.
 *
 * The refusal names the subsystem, unlike the containment refusal above. This
 * is not a boundary against the caller, it is a rule they should understand
 * rather than route around.
 */
export function resolveWritableInRoot(relPath: string, root: string): ResolveOk | ResolveErr {
  const resolved = resolveInRoot(relPath, root);
  if (!resolved.ok) return resolved;

  const real = realAncestor(resolved.abs);
  const realRoot = realAncestor(root);
  if (!isPathWithinVault(real, realRoot)) {
    return {
      ok: false,
      result: errorResult(
        `Path "${relPath}" resolves outside the knowledge-base vault, refusing to access it.`,
      ),
    };
  }

  const segments = toPosix(path.relative(realRoot, real)).split("/").filter(Boolean).map((s) => s.toLowerCase());
  const owned = SYSTEM_WRITE_DENY.find((pattern) => {
    const patternSegments = pattern.toLowerCase().split("/").filter(Boolean);
    return patternSegments.every((segment, i) => segments[i] === segment);
  });
  if (!owned) return resolved;

  const reason = SYSTEM_WRITE_DENY_REASON[owned] ?? "a portal subsystem";
  return {
    ok: false,
    result: errorResult(
      `"${owned}/" is maintained by ${reason} and is not editable here. Read it freely; changes to it come from that subsystem.`,
    ),
  };
}

/** The read-path's containment check: always against the live `vaultRoot()`. */
export function resolveInVault(relPath: string, root: string = vaultRoot()): ResolveOk | ResolveErr {
  return resolveInRoot(relPath, root);
}
