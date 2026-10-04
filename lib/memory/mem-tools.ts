import { readdir, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolveInMemory } from "./paths";
import {
  classifySharedPath,
  isWithinFileReadScope,
  isWithinListScope,
  isWithinDeleteScope,
  isWithinWriteScope,
  relativeToMemoryRoot,
  visibleSharedRootEntries,
  type MemScope,
} from "./scope";

export type { MemScope };

/**
 * Pure filesystem handlers for the `mem` MCP server (see `./mem-server`).
 * Every path is containment-checked via `resolveInMemory`; read/write/delete
 * require a `.md` extension. Handlers return the SDK text-content shape and
 * never throw: a bad path becomes a clear error string the model can act on,
 * exactly like `lib/kb-mcp/tools.ts`.
 */

type ToolResult = { content: { type: "text"; text: string }[] };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

function requireMarkdown(rel: string): string | null {
  return rel.toLowerCase().endsWith(".md") ? rel : null;
}

/**
 * Denial text. Deliberately identical whether a path is uncleared, names a
 * group that does not exist, or belongs to another user: the caller must not
 * be able to tell those apart, or the error itself becomes an enumeration
 * oracle for group and user names (spec 32).
 */
const DENIED_READ = (rel: string) =>
  ok(`Path "${rel}" is outside your readable memory scope (shared groups you are cleared for, or your own users/ subtree); denied.`);
const DENIED_WRITE = (rel: string) =>
  ok(`Path "${rel}" is outside your writable memory scope (shared groups you are cleared for, or your own users/ subtree); denied.`);

export async function memList(args: { path?: string }, scope?: MemScope): Promise<ToolResult> {
  const rel = args.path?.trim() || "memory";
  const abs = resolveInMemory(rel);
  if (!abs) return ok(`Path "${rel}" is outside the memory store; denied.`);
  if (scope && !isWithinListScope(abs, scope)) return DENIED_READ(rel);
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    let shaped = entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    // Listing the shared ROOT reveals group directory names, so filter it to
    // the caller's clearance. Without this, `isWithinListScope` would let a
    // caller enumerate every group name and only fail when they tried to open
    // one.
    if (scope && classifySharedPath(relativeToMemoryRoot(abs)).kind === "shared-root") {
      shaped = visibleSharedRootEntries(shaped, scope.clearance);
    }
    if (shaped.length === 0) return ok(`(empty) ${rel}`);
    const lines = shaped.map((e) => (e.isDir ? `${e.name}/` : e.name)).sort();
    return ok(lines.join("\n"));
  } catch {
    return ok(`No such directory: ${rel}`);
  }
}

export async function memRead(args: { path: string }, scope?: MemScope): Promise<ToolResult> {
  const rel = requireMarkdown(args.path.trim());
  if (!rel) return ok(`Only .md files can be read from memory.`);
  const abs = resolveInMemory(rel);
  if (!abs) return ok(`Path "${args.path}" is outside the memory store; denied.`);
  if (scope && !isWithinFileReadScope(abs, scope)) return DENIED_READ(rel);
  try {
    return ok(await readFile(abs, "utf8"));
  } catch {
    return ok(`Not found: ${rel}`);
  }
}

export async function memWrite(
  args: { path: string; content: string },
  scope?: MemScope,
): Promise<ToolResult> {
  const rel = requireMarkdown(args.path.trim());
  if (!rel) return ok(`Memory files must be markdown (.md).`);
  const abs = resolveInMemory(rel);
  if (!abs) return ok(`Path "${args.path}" is outside the memory store; denied.`);
  if (scope && !isWithinWriteScope(abs, scope)) return DENIED_WRITE(rel);
  try {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, args.content, "utf8");
    return ok(`Wrote ${rel}`);
  } catch (err) {
    return ok(`Could not write ${rel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function memDelete(args: { path: string }, scope?: MemScope): Promise<ToolResult> {
  const rel = requireMarkdown(args.path.trim());
  if (!rel) return ok(`Only .md files can be deleted from memory.`);
  const abs = resolveInMemory(rel);
  if (!abs) return ok(`Path "${args.path}" is outside the memory store; denied.`);
  if (scope && !isWithinDeleteScope(abs, scope)) return DENIED_WRITE(rel);
  try {
    await stat(abs);
  } catch {
    return ok(`Not found: ${rel}`);
  }
  try {
    await rm(abs);
    return ok(`Deleted ${rel}`);
  } catch (err) {
    return ok(`Could not delete ${rel}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
