import { isKbWriteEnabled } from "@/lib/authority/write-gate";
import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Gates the approver's review queue: the `/review` surface, its nav entry, and
 * the queue and decision endpoints. Off, an approver reviews in GitLab as today.
 */
export function isKbReviewEnabled(): boolean {
  return isFlagEnabled("KB_REVIEW_ENABLED");
}

/** Delete proposes through the write path, so it is inert without it. */
export function isKbDeleteEnabled(): boolean {
  return isFlagEnabled("KB_DELETE_ENABLED") && isKbWriteEnabled();
}
