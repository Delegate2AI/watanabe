import { loadTranscript } from "@/lib/agent/transcript";
import type { TextSegment, Turn } from "@/lib/agent/conversation";

/**
 * Render a thread's transcript to plain text for the dream prompt. Reuses the
 * same `loadTranscript` the chat UI uses to reopen a past thread (see
 * lib/agent/transcript.ts) rather than re-reading the SDK's on-disk store
 * directly. Best-effort: returns "" on any error (unknown session id, disk
 * read failure), and skips turns that carry no renderable text (tool-only
 * assistant turns, compaction markers).
 */
export async function readTranscriptText(sdkSessionId: string): Promise<string> {
  try {
    const turns = await loadTranscript(sdkSessionId);
    const lines: string[] = [];
    for (const turn of turns) {
      const line = renderTurn(turn);
      if (line) lines.push(line);
    }
    return lines.join("\n\n");
  } catch {
    return "";
  }
}

function isTextSegment(segment: { kind: string }): segment is TextSegment {
  return segment.kind === "text";
}

/** One turn to one line, or null when it has nothing worth rendering. */
function renderTurn(turn: Turn): string | null {
  if (turn.role === "user") {
    const content = turn.content.trim();
    return content ? `USER: ${content}` : null;
  }
  if (turn.role === "assistant") {
    const text = turn.segments
      .filter(isTextSegment)
      .map((s) => s.text)
      .join("\n")
      .trim();
    return text ? `ASSISTANT: ${text}` : null;
  }
  // compaction markers carry no conversational content
  return null;
}
