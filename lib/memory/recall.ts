import { readFileSync } from "node:fs";
import { governancePath, sharedGroupIndexPath, sharedIndexPath, userIndexPath } from "./paths";
import { isMemoryEnabled } from "./config";
import { sanitizeClearance } from "./scope";

/**
 * Assemble the memory context appended to a chat session's system prompt.
 * `config.ts` sets `settingSources: []`, so the SDK loads no CLAUDE.md itself:
 * recall reads the files directly and hands the text to `buildOptions`. Only
 * the INDEXES go in the prompt; the agent pulls full memory bodies on demand
 * via `mcp__mem__mem_read`.
 *
 * This is the SECOND read channel over shared memory, and it never touches the
 * `mem` MCP server, so the scope checks in `./scope` do not cover it. It must
 * apply clearance itself (spec 32 R2): a shared index line pulled into the
 * prompt is a disclosure even if the follow-up `mem_read` would be denied.
 *
 * Synchronous because the only caller, `AgentSession`'s constructor (see
 * `lib/agent/session.ts`), builds `query()`'s options before it can await
 * anything. Cost is proportional to the caller's clearance (one index read per
 * cleared group), not to the size of shared memory.
 */
export function buildMemoryContextSync(ownerEmail: string, clearance: string[] = []): string {
  if (!isMemoryEnabled()) return "";
  const read = (p: string): string => {
    try {
      return readFileSync(p, "utf8").trim();
    } catch {
      return "";
    }
  };
  const gov = read(governancePath());
  const mine = read(userIndexPath(ownerEmail));
  const sections: string[] = [];
  if (gov) sections.push(gov);

  // Clearance is PATH INPUT below, not just a gate, and groups.yaml keys are
  // unvalidated (`lib/authority/groups.ts` checks member emails, not keys). An
  // unsanitized key like "../users/victim-at-example.com" would otherwise read
  // another user's private index straight into this prompt.
  const cleared = sanitizeClearance(clearance);

  // Legacy flat shared index at memory/shared/MEMORY.md, covering the
  // pre-spec-32 files directly under memory/shared/. Those read as all-hands
  // (D32.2), so this section is gated on all-hands rather than shown
  // unconditionally.
  if (cleared.includes("all-hands")) {
    const legacy = read(sharedIndexPath());
    if (legacy) sections.push(["## Shared memory index", legacy].join("\n"));
  }

  // One index per cleared group. Iterating clearance rather than listing
  // memory/shared/ means an uncleared group's index is never opened and its
  // name never reaches the prompt.
  for (const group of cleared) {
    const groupIndex = read(sharedGroupIndexPath(group));
    if (groupIndex) sections.push([`## Shared memory index (${group})`, groupIndex].join("\n"));
  }

  if (mine) sections.push(["## Your memory index", mine].join("\n"));
  if (sections.length === 0) return "";
  return [
    "PERSISTENT MEMORY",
    "Durable context from prior sessions. Read specific files with mcp__mem__mem_read when relevant.",
    "",
    ...sections,
  ].join("\n");
}
