import { isFlagEnabled } from "@/lib/config/flags";
import { isKbWriteEnabled } from "@/lib/authority/write-gate";

/**
 * Spec 28 feature flags. `SHARED_DOCS_ENABLED` gates the whole shared-docs
 * surface: off, `/docs` is an empty scaffold, the API routes are dark, and no
 * share action exists. `EXTERNAL_SHARE_ENABLED` ADDITIONALLY gates the only
 * unauthenticated read surface (signed external links). Both default off, so
 * flag-off leaves every existing byte-path identical.
 */
export function isSharedDocsEnabled(): boolean {
  return isFlagEnabled("SHARED_DOCS_ENABLED");
}

/**
 * External signed links require BOTH the shared-docs flag and the external flag.
 * A link can never be minted or resolved unless the whole feature is on and the
 * operator has explicitly opted into unauthenticated external access.
 */
export function isExternalShareEnabled(): boolean {
  return isSharedDocsEnabled() && isFlagEnabled("EXTERNAL_SHARE_ENABLED");
}

/**
 * Anchored comment threads and proposed edits (spec 2026-07-22). Requires BOTH
 * the shared-docs flag and its own flag, so flag-off leaves every existing
 * byte-path identical: the legacy flat comments panel still renders and the new
 * routes are dark.
 */
export function isDocAnnotationsEnabled(): boolean {
  return isSharedDocsEnabled() && isFlagEnabled("DOC_ANNOTATIONS_ENABLED");
}

/**
 * Team sharing (migration v26). Requires BOTH the shared-docs flag and its own,
 * and is the runtime kill switch an operator needs for a change to the ACL.
 *
 * Flag-off is a clean fall-back to the previous byte-paths: the share dialog
 * renders the original "add people by email" box, the API refuses a group
 * recipient, and every access resolver passes an empty clearance so only user
 * rows match. Note what that last part means operationally: turning this off
 * does not delete existing team grants, it stops them RESOLVING, so access
 * narrows rather than widening. Turning it back on restores them intact.
 */
export function isDocGroupSharingEnabled(): boolean {
  return isSharedDocsEnabled() && isFlagEnabled("DOC_GROUP_SHARING_ENABLED");
}

/**
 * Publishing a shared doc to the knowledge base (spec 2026-08-11). Requires the
 * shared-docs flag, its own flag, AND the write path (`KB_WRITE_ENABLED`), since
 * this is the spec-03 write path with a different entry point rather than a new
 * way to reach the vault.
 *
 * Flag-off is a clean fall-back: no publish card renders, the route 404s, and a
 * shared doc's only disposition is its ACL, exactly as before.
 */
/**
 * Importing an existing file as a shared document. Requires BOTH the shared-docs
 * flag and its own, and is the runtime kill switch for the one route that
 * accepts an uploaded file into the document store.
 *
 * Flag-off is a clean fall-back to the previous byte-paths: `/docs` renders no
 * drop target and no import control, and the import route 404s, so the only way
 * to create a document is the create dialog, exactly as before.
 */
export function isDocImportEnabled(): boolean {
  return isSharedDocsEnabled() && isFlagEnabled("DOC_IMPORT_ENABLED");
}

export function isSharedDocPublishEnabled(): boolean {
  return isSharedDocsEnabled() && isKbWriteEnabled() && isFlagEnabled("SHARED_DOC_PUBLISH_ENABLED");
}

/**
 * Asking the owner for access to a document you cannot open (migration v33).
 * Requires BOTH the shared-docs flag and its own, and is the runtime kill switch
 * for the one place this feature relaxes spec 28's no-oracle rule: the "You need
 * access" screen confirms that a document with that id exists.
 *
 * That is the point of the feature and it is a narrow relaxation. It renders
 * only for an authenticated portal identity, only for an id they were given (ids
 * are UUIDs, so they are not guessable), and it discloses nothing beyond
 * existence: no title, no owner, no body. Flag-off is a clean fall-back to the
 * previous byte-path, a bare 404 with no request affordance and dark routes.
 */
export function isDocAccessRequestsEnabled(): boolean {
  return isSharedDocsEnabled() && isFlagEnabled("DOC_ACCESS_REQUESTS_ENABLED");
}

/**
 * The doc copilot panel (spec 2026-08-27): a chat bound to one shared document
 * whose only write tool files suggestions. Requires the annotations subsystem
 * (which itself requires shared docs), because the suggest tool writes that
 * subsystem's tables and the margin is where its proposals are reviewed.
 * Flag-off is a clean fall-back: no panel, no copilot MCP server, and the
 * agent route refuses a doc binding.
 */
export function isDocCopilotEnabled(): boolean {
  return isDocAnnotationsEnabled() && isFlagEnabled("DOC_COPILOT_ENABLED");
}
