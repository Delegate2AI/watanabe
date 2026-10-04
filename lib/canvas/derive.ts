import type { AssistantTurn, Turn } from "@/lib/agent/conversation";

/**
 * Client-safe derivation of chat documents from the transcript (spec 29). The
 * canvas opens on the `doc_write` tool event, not a heuristic: this reads the
 * `mcp__doc__doc_write` tool segments the conversation reducer already built and
 * pulls out the `{ docId, version, title }` the tool returned.
 *
 * Type-only imports from `@/lib/agent/conversation` keep this module free of any
 * server value, so it is safe to pull into a "use client" component.
 */

/** The tool name the doc MCP server registers (see lib/doc-mcp/server.ts). */
export const DOC_WRITE_TOOL = "mcp__doc__doc_write";

export interface ChatDocRef {
  docId: string;
  version: number;
  title: string;
}

function isChatDocRef(value: unknown): value is ChatDocRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.docId === "string" && typeof v.version === "number" && typeof v.title === "string";
}

/**
 * Extract a `{ docId, version, title }` from a `doc_write` tool result. The MCP
 * result is a content array `[{ type: "text", text: "<json>" }]`; a bare JSON
 * string is also accepted. Returns null for anything that is not a doc result.
 */
export function parseDocWriteResult(result: unknown): ChatDocRef | null {
  let text: string | null = null;
  if (typeof result === "string") {
    text = result;
  } else if (Array.isArray(result)) {
    const block = result.find(
      (b): b is { type: string; text: string } =>
        typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    );
    text = block?.text ?? null;
  }
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return isChatDocRef(parsed) ? { docId: parsed.docId, version: parsed.version, title: parsed.title } : null;
  } catch {
    return null;
  }
}

/** The successful `doc_write` results in a single assistant turn, in order. */
export function docsInTurn(turn: AssistantTurn): ChatDocRef[] {
  const out: ChatDocRef[] = [];
  for (const seg of turn.segments) {
    if (seg.kind !== "tool" || seg.name !== DOC_WRITE_TOOL || seg.status !== "ok") continue;
    const ref = parseDocWriteResult(seg.result);
    if (ref) out.push(ref);
  }
  return out;
}

/**
 * The docId of the most recent `doc_write` across the transcript: the client's
 * "active doc" signal that opens or updates the canvas. Null when no document
 * has been written yet.
 */
export function activeDocId(turns: Turn[]): string | null {
  let latest: string | null = null;
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    for (const ref of docsInTurn(turn)) latest = ref.docId;
  }
  return latest;
}
