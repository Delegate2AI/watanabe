import { isKbWriteEnabled } from "@/lib/authority/write-gate";
import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Spec 27 feature flag. `ARTIFACTS_ENABLED` gates the whole artifacts surface:
 * off, the `/artifacts` route is an empty state and the chat "Save as artifact"
 * action is hidden. Defaults off, so flag-off leaves every existing byte-path
 * identical.
 */
export function isArtifactsEnabled(): boolean {
  return isFlagEnabled("ARTIFACTS_ENABLED");
}

/**
 * Publishing an artifact to the KB additionally requires the write path to be
 * enabled (`KB_WRITE_ENABLED`), on top of the artifacts flag. Role is checked
 * separately (spec 22) at the point of publish.
 */
export function isArtifactPublishEnabled(): boolean {
  return isArtifactsEnabled() && isKbWriteEnabled();
}

/**
 * "Propose an edit" on a KB note (spec 2026-08-11). Requires the publish path
 * (an edit is a publish at an existing path) plus its own flag, which is the
 * runtime kill switch for the one action that writes over notes someone else
 * authored.
 *
 * Flag-off is exactly today's behaviour: `canProposeEdit` is false so the
 * control is absent, and the create route refuses a `sourcePath` request, so the
 * only way into an artifact remains a caller-authored body.
 */
export function isKbProposeEditEnabled(): boolean {
  return isArtifactPublishEnabled() && isFlagEnabled("KB_PROPOSE_EDIT_ENABLED");
}
