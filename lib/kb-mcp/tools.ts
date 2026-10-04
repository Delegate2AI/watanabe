import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  errorResult,
  isIgnoredRelPath,
  resolveInVault,
  textResult,
  toPosix,
  KNOWN_BINARY_EXTENSIONS,
  KNOWN_TEXT_EXTENSIONS,
} from "./paths";

export { IGNORED_PATTERNS } from "./constants";
// Re-exported so the callers that have always imported these from `tools` keep
// working; they live in `./paths` now.
export {
  errorResult,
  textResult,
  resolveInRoot,
  resolveWritableInRoot,
  resolveInVault,
  KNOWN_BINARY_EXTENSIONS,
  KNOWN_TEXT_EXTENSIONS,
} from "./paths";
export type { ResolveOk, ResolveErr } from "./paths";

/**
 * Read-only vault tools shared by BOTH MCP surfaces this portal exposes:
 *  - `lib/kb-mcp/server.ts` — the in-process `createSdkMcpServer` instance
 *    wired into the chat agent's `Options.mcpServers` (see `lib/agent/config.ts`).
 *  - `app/api/mcp/route.ts` — the same three tools re-registered on a plain
 *    `@modelcontextprotocol/sdk` `McpServer` and exposed over HTTP for other
 *    clients.
 *
 * Deliberately plain, framework-agnostic async functions (not tied to either
 * SDK's tool-definition wrapper) so they can be:
 *  - unit-tested directly, with no SDK query loop in the way;
 *  - registered under the Agent SDK's Zod-raw-shape `tool()` helper AND the
 *    MCP SDK's `McpServer#registerTool` from the same implementation.
 *
 * Every handler resolves its target path through `./paths` FIRST and only THEN
 * touches the filesystem. A violation returns a `CallToolResult` with
 * `isError: true` and never throws, so a confused caller gets a structured
 * refusal instead of an exception out of the MCP transport.
 *
 * Every `readdirSync`/`statSync`/`readFileSync` call below carries a
 * `turbopackIgnore` comment: the path is runtime-computed, and without it the
 * Node File Trace pulls the whole project into the standalone build output.
 */

/** Max bytes `kb_read` will read from a single file. */
const MAX_READ_BYTES = 1_048_576; // 1 MiB

/** Max entries `kb_list` will return, recursive or not — a runaway guard, not a real limit for this KB's size. */
const MAX_LIST_ENTRIES = 2000;

/** Max matching lines `kb_search` will return across all files. */
const MAX_SEARCH_MATCHES = 50;

/** Max files `kb_search` will open+scan before giving up (a KB of dozens of files never gets close). */
const MAX_SEARCH_FILES_SCANNED = 5000;


// ── kb_list ──────────────────────────────────────────────────────────────

export interface KbListInput {
  /** Path relative to the vault root. Defaults to "." (the vault root itself). */
  path?: string;
  /** List recursively (bounded by MAX_LIST_ENTRIES). Defaults to false. */
  recursive?: boolean;
}

interface ListEntry {
  relPath: string;
  type: "file" | "dir";
}

function listDirOnce(absDir: string, root: string): ListEntry[] {
  const out: ListEntry[] = [];
  for (const dirent of readdirSync(/* turbopackIgnore: true */ absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, dirent.name);
    const rel = path.relative(root, abs);
    if (isIgnoredRelPath(rel)) continue;
    out.push({ relPath: toPosix(rel), type: dirent.isDirectory() ? "dir" : "file" });
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function listDirRecursive(absDir: string, root: string, cap: number): { entries: ListEntry[]; truncated: boolean } {
  const entries: ListEntry[] = [];
  let truncated = false;
  const stack: string[] = [absDir];
  while (stack.length > 0) {
    const current = stack.shift()!;
    let dirents;
    try {
      dirents = readdirSync(/* turbopackIgnore: true */ current, { withFileTypes: true });
    } catch {
      continue; // e.g. a symlink race or permissions error — skip, don't crash the walk
    }
    for (const dirent of dirents) {
      const abs = path.join(current, dirent.name);
      const rel = path.relative(root, abs);
      if (isIgnoredRelPath(rel)) continue;
      if (entries.length >= cap) {
        truncated = true;
        break;
      }
      entries.push({ relPath: toPosix(rel), type: dirent.isDirectory() ? "dir" : "file" });
      if (dirent.isDirectory()) stack.push(abs);
    }
    if (truncated) break;
  }
  return { entries: entries.sort((a, b) => a.relPath.localeCompare(b.relPath)), truncated };
}

/**
 * List files/directories under a vault-relative path. Non-recursive by
 * default; excludes the Quartz-mirrored ignore set (see `IGNORED_PATTERNS`).
 */
export async function kbList(input: KbListInput, scopeRoot?: string): Promise<CallToolResult> {
  const resolved = resolveInVault(input.path ?? ".", scopeRoot);
  if (!resolved.ok) return resolved.result;
  const { abs, root, relInput } = resolved;

  let stat;
  try {
    stat = statSync(/* turbopackIgnore: true */ abs);
  } catch {
    return errorResult(`No such path in the knowledge base: "${relInput}".`);
  }
  if (!stat.isDirectory()) {
    return errorResult(`"${relInput}" is a file, not a directory — use kb_read to read it.`);
  }

  const { entries, truncated } = input.recursive
    ? listDirRecursive(abs, root, MAX_LIST_ENTRIES)
    : { entries: listDirOnce(abs, root), truncated: false };

  if (entries.length === 0) {
    return textResult(`(empty — no entries under "${relInput}")`);
  }

  const lines = entries.map((e) => `${e.type === "dir" ? "d" : "f"}  ${e.relPath}`);
  if (truncated) lines.push(`… truncated at ${MAX_LIST_ENTRIES} entries`);
  return textResult(lines.join("\n"));
}

// ── kb_read ──────────────────────────────────────────────────────────────

export interface KbReadInput {
  /** Path relative to the vault root of the file to read. */
  path: string;
}

/** Read one file's contents by vault-relative path. `.md` and other reasonable text files only; rejects binary/huge files. */
export async function kbRead(input: KbReadInput, scopeRoot?: string): Promise<CallToolResult> {
  if (!input.path || input.path.trim() === "") {
    return errorResult("kb_read requires a non-empty path.");
  }
  const resolved = resolveInVault(input.path, scopeRoot);
  if (!resolved.ok) return resolved.result;
  const { abs, relInput } = resolved;

  let stat;
  try {
    stat = statSync(/* turbopackIgnore: true */ abs);
  } catch {
    return errorResult(`No such file in the knowledge base: "${relInput}".`);
  }
  if (!stat.isFile()) {
    return errorResult(`"${relInput}" is not a regular file (it's a directory?) — use kb_list on it instead.`);
  }
  if (stat.size > MAX_READ_BYTES) {
    return errorResult(
      `"${relInput}" is ${stat.size} bytes, over the ${MAX_READ_BYTES}-byte cap for kb_read — too large to read whole.`,
    );
  }

  const ext = path.extname(abs).toLowerCase();
  if (KNOWN_BINARY_EXTENSIONS.has(ext)) {
    return errorResult(`"${relInput}" looks like a binary file (${ext}) — kb_read only supports text files.`);
  }

  const buffer = readFileSync(/* turbopackIgnore: true */ abs);
  if (!KNOWN_TEXT_EXTENSIONS.has(ext) && buffer.includes(0)) {
    return errorResult(`"${relInput}" looks like a binary file — kb_read only supports text files.`);
  }

  return textResult(buffer.toString("utf8"));
}

// ── kb_search ────────────────────────────────────────────────────────────

export interface KbSearchInput {
  /** Text to search for (case-insensitive substring match). */
  query: string;
  /** Restrict the search to this vault-relative path. Defaults to the whole vault. */
  path?: string;
}

interface SearchMatch {
  relPath: string;
  line: number;
  snippet: string;
}

function walkTextFiles(absDir: string, root: string, budget: { filesLeft: number }): string[] {
  const files: string[] = [];
  const stack: string[] = [absDir];
  while (stack.length > 0 && budget.filesLeft > 0) {
    const current = stack.shift()!;
    let dirents;
    try {
      dirents = readdirSync(/* turbopackIgnore: true */ current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (budget.filesLeft <= 0) break;
      const abs = path.join(current, dirent.name);
      const rel = path.relative(root, abs);
      if (isIgnoredRelPath(rel)) continue;
      if (dirent.isDirectory()) {
        stack.push(abs);
        continue;
      }
      const ext = path.extname(abs).toLowerCase();
      if (KNOWN_BINARY_EXTENSIONS.has(ext)) continue;
      files.push(abs);
      budget.filesLeft -= 1;
    }
  }
  return files;
}

/**
 * Grep-equivalent recursive text search. A simple, synchronous per-line scan
 * is deliberate — this KB is dozens of files, not an index-worthy corpus (see
 * the module doc comment on `lib/kb-mcp/server.ts`). Caps at
 * `MAX_SEARCH_MATCHES` matches across all files and `MAX_SEARCH_FILES_SCANNED`
 * files scanned.
 */
export async function kbSearch(input: KbSearchInput, scopeRoot?: string): Promise<CallToolResult> {
  if (!input.query || input.query.trim() === "") {
    return errorResult("kb_search requires a non-empty query.");
  }
  const resolved = resolveInVault(input.path ?? ".", scopeRoot);
  if (!resolved.ok) return resolved.result;
  const { abs, root, relInput } = resolved;

  let stat;
  try {
    stat = statSync(/* turbopackIgnore: true */ abs);
  } catch {
    return errorResult(`No such path in the knowledge base: "${relInput}".`);
  }
  if (!stat.isDirectory()) {
    return errorResult(`"${relInput}" is a file, not a directory — pass a directory (or omit) as the search scope.`);
  }

  const needle = input.query.toLowerCase();
  const files = walkTextFiles(abs, root, { filesLeft: MAX_SEARCH_FILES_SCANNED });

  const matches: SearchMatch[] = [];
  outer: for (const file of files) {
    let text: string;
    try {
      const buf = readFileSync(/* turbopackIgnore: true */ file);
      if (buf.includes(0)) continue; // binary, no extension hint — skip
      text = buf.toString("utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push({
          relPath: toPosix(path.relative(root, file)),
          line: i + 1,
          snippet: lines[i].trim().slice(0, 300),
        });
        if (matches.length >= MAX_SEARCH_MATCHES) break outer;
      }
    }
  }

  if (matches.length === 0) {
    return textResult(`No matches for "${input.query}" under "${relInput}".`);
  }

  const lines = matches.map((m) => `${m.relPath}:${m.line}: ${m.snippet}`);
  if (matches.length >= MAX_SEARCH_MATCHES) lines.push(`… truncated at ${MAX_SEARCH_MATCHES} matches`);
  return textResult(lines.join("\n"));
}
