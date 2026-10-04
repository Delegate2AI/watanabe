import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { isAuthorityEnabled } from "@/lib/authority/config";
import { getDb } from "@/lib/db/client";
import { getThreadOwner } from "@/lib/db/threads";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { vaultRoot, vaultRootFor } from "@/lib/repo";
import type { AssistantTurn, Segment, Turn } from "./conversation";
import { parseContextBlock } from "./context-block";

/**
 * Resume-by-id loading for the KB chat. The SDK's actual storage ROOT is
 * `CLAUDE_CONFIG_DIR` (falling back to `$HOME/.claude` — see
 * `portal/Dockerfile`'s `ENV CLAUDE_CONFIG_DIR` for the full investigation);
 * `sessionStorageRoot()` feeds the `dir` option, which the SDK sanitizes into
 * a project-key subdirectory under that root, not the root itself. This reads
 * ONE session back (by id) so the contributor can reopen their last chat. We
 * deliberately don't expose a "list all sessions" helper here — the store
 * (under that project key) is global to that directory, so listing it could
 * surface unrelated Claude Code sessions. See `lib/db/threads.ts` for the
 * "past chats" list, scoped to this agent AND to the requesting owner
 * (ownership enforced by the caller — see `lib/db/ownership.ts` — before this
 * function is ever reached).
 */

export function sessionStorageRoot(sessionId: string, clearanceSet?: string[]): string {
  if (!isAuthorityEnabled()) return vaultRoot();
  if (clearanceSet) return vaultRootFor(clearanceSet);
  try {
    const owner = getThreadOwner(getDb(), sessionId);
    return vaultRootFor(owner ? resolveClearanceForEmail(owner) : ["all-hands"]);
  } catch {
    return vaultRootFor(["all-hands"]);
  }
}

/** Rebuild a stored session's transcript into the chat's Turn[] model. */
export async function loadTranscript(sessionId: string, clearanceSet?: string[]): Promise<Turn[]> {
  const messages = await getSessionMessages(sessionId, {
    dir: sessionStorageRoot(sessionId, clearanceSet),
  });
  const turns: Turn[] = [];

  for (const msg of messages) {
    if (msg.type === "user") {
      const content = (msg.message as { content?: unknown }).content;
      if (attachToolResults(turns, content)) continue; // tool output → fold into a tool pill
      const text = userText(content);
      if (text.trim()) {
        // A stored user message may carry a <portal-context> block (spec 11)
        // prepended ahead of the contributor's own typed text — split it back
        // into chips + the remainder so a resumed thread renders the same
        // chips + message shape a live turn does.
        const parsed = parseContextBlock(text);
        turns.push(
          parsed
            ? { id: msg.uuid, role: "user", content: parsed.remainder, context: parsed.chips }
            : { id: msg.uuid, role: "user", content: text },
        );
      }
    } else if (msg.type === "assistant") {
      const turn = assistantTurn(msg.uuid, (msg.message as { content?: unknown[] }).content ?? []);
      if (turn.segments.length > 0) turns.push(turn);
    }
    // system messages are not rendered in the transcript
  }
  return turns;
}

function userText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: string; text: string } => {
      const x = b as { type?: string; text?: unknown };
      return x.type === "text" && typeof x.text === "string";
    })
    .map((b) => b.text)
    .join("\n");
}

function assistantTurn(id: string, blocks: unknown[]): AssistantTurn {
  const segments: Segment[] = [];
  for (const raw of blocks) {
    const b = raw as { type?: string; id?: string; name?: string; input?: unknown; text?: string };
    if (b.type === "text" && typeof b.text === "string" && b.text) {
      const last = segments[segments.length - 1];
      if (last && last.kind === "text") last.text += b.text;
      else segments.push({ kind: "text", text: b.text });
    } else if (b.type === "tool_use") {
      segments.push({
        kind: "tool",
        id: b.id ?? "",
        name: b.name ?? "tool",
        input: b.input ?? {},
        status: "ok", // history = completed; refined by a later tool_result
      });
    }
  }
  return { id, role: "assistant", segments, status: "done" };
}

/** If `content` carries tool_result blocks, fold them into existing tool pills. */
function attachToolResults(turns: Turn[], content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  const results = content.filter((b) => (b as { type?: string }).type === "tool_result");
  if (results.length === 0) return false;

  for (const raw of results) {
    const r = raw as { tool_use_id?: string; content?: unknown; is_error?: boolean };
    for (let t = turns.length - 1; t >= 0; t--) {
      const turn = turns[t];
      if (turn.role !== "assistant") continue;
      const seg = turn.segments.find((s) => s.kind === "tool" && s.id === r.tool_use_id);
      if (seg && seg.kind === "tool") {
        seg.status = r.is_error ? "error" : "ok";
        seg.result = r.content;
        break;
      }
    }
  }
  return true;
}
