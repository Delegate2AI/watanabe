"use client";

import { memo } from "react";
import type { AssistantTurn, Turn } from "@/lib/agent/conversation";
import { docsInTurn } from "@/lib/canvas/derive";
import { DocumentCard } from "@/components/canvas/document-card";
import { ThreadTurn, type SaveState } from "./thread-turn";
import { AssistantTurnBody } from "./assistant-turn-body";

/** The plain-text body of an assistant turn: its text segments, concatenated. */
export function assistantText(turn: AssistantTurn): string {
  return turn.segments
    .filter((s): s is Extract<typeof s, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text)
    .join("")
    .trim();
}

/**
 * One row of the live transcript, and the memo boundary that makes streaming
 * cheap.
 *
 * Every token of an answer produces a new `turns` array, so the Thread re-renders
 * roughly as fast as the model writes. Without this boundary that re-render
 * reached every turn in the conversation: each one re-derived its text, re-ran
 * `docsInTurn`, and re-parsed its markdown through remark and the syntax highlighter,
 * so the cost of one token scaled with the length of the whole thread.
 *
 * `applyEvent` leaves settled turns referentially identical, and every other prop
 * here is a primitive or a stable callback, so the default shallow comparison
 * skips all of them and only the turn being written re-renders. Keep it that way:
 * an inline arrow or a fresh object in the parent's JSX would silently restore
 * the old behaviour. That is why this takes `onSave(turn)` rather than a
 * pre-bound `onSaveAsArtifact`.
 */
export const TranscriptTurn = memo(function TranscriptTurn({
  turn,
  initials,
  artifactsEnabled,
  canvasEnabled,
  saveState,
  savedHref,
  onSave,
  onOpenDoc,
}: {
  turn: Turn;
  initials: string;
  artifactsEnabled: boolean;
  canvasEnabled: boolean;
  saveState?: SaveState;
  savedHref?: string;
  onSave: (turn: AssistantTurn) => void;
  onOpenDoc: (docId: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <ThreadTurn role="user" avatar={initials}>
        <p className="whitespace-pre-wrap">{turn.content}</p>
      </ThreadTurn>
    );
  }
  if (turn.role !== "assistant") return null;

  const canSave =
    artifactsEnabled && turn.status !== "streaming" && assistantText(turn) !== "";

  return (
    <ThreadTurn
      role="assistant"
      onSaveAsArtifact={canSave ? () => onSave(turn) : undefined}
      saveState={saveState}
      savedHref={savedHref}
    >
      <AssistantTurnBody turn={turn} />
      {/* Spec 29: a compact card where doc_write was called. Gated on
          canvasEnabled so flag-off renders nothing (byte-identical). */}
      {canvasEnabled &&
        docsInTurn(turn).map((doc) => (
          <DocumentCard key={doc.docId} doc={doc} onOpen={onOpenDoc} />
        ))}
    </ThreadTurn>
  );
});
