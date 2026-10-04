/**
 * Divergence detection for the three-object problem (spec 29): after a chat
 * document is promoted, the same content can be edited in the chat document (the
 * agent revises it), the Artifact (the owner edits it), and the Shared File (an
 * edit-access recipient revises it). Update is always ADDITIVE (it appends a new
 * target version, so no target edit is ever destroyed), but a naive Update
 * silently moves the target's current pointer past edits the user may not know
 * about. This pure, client-safe function classifies an Update so the pane and
 * the route can warn before advancing the pointer.
 *
 * The four inputs come from the chat document and the promotion row:
 *  - chatCurrentVersion: the chat document's latest version.
 *  - promotedVersion: the chat-doc version recorded on the last promote/update.
 *  - targetCurrentVersion: the target's live current version, right now.
 *  - targetVersionAtPromote: the target's version recorded on the last
 *    promote/update.
 */

export type UpdateStatus = "up_to_date" | "chat_ahead" | "diverged";

export interface UpdateClassification {
  status: UpdateStatus;
  /** True only for `diverged`: the caller must confirm before Update advances the target. */
  warn: boolean;
  /** The additive version an Update would append to the target (current + 1). */
  projectedTargetVersion: number;
}

export function classifyUpdate(input: {
  chatCurrentVersion: number;
  promotedVersion: number;
  targetCurrentVersion: number;
  targetVersionAtPromote: number;
}): UpdateClassification {
  const projectedTargetVersion = input.targetCurrentVersion + 1;
  // Nothing newer than what was already promoted: an Update would be a no-op.
  if (input.chatCurrentVersion <= input.promotedVersion) {
    return { status: "up_to_date", warn: false, projectedTargetVersion };
  }
  // The target moved on its own since the promotion: overwriting its current
  // pointer must never be silent, so warn.
  if (input.targetCurrentVersion > input.targetVersionAtPromote) {
    return { status: "diverged", warn: true, projectedTargetVersion };
  }
  // Only the chat doc is ahead: Update pushes cleanly.
  return { status: "chat_ahead", warn: false, projectedTargetVersion };
}
