import type { Database as DatabaseType } from "better-sqlite3";
import { getSharedDoc } from "@/lib/db/shared-docs";
import { accessFor, canComment } from "@/lib/shared-docs/access";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { isDocCopilotEnabled } from "@/lib/shared-docs/config";
import type { DocBinding } from "@/lib/agent/copilot-prompt";

/**
 * Resolve a doc-copilot binding for one caller (spec 2026-08-27), or null.
 * Null collapses every refusal into one answer: flag off, unknown doc, and a
 * caller below comment tier are indistinguishable (no existence oracle). The
 * route turns null into its uniform 404.
 */
export function resolveDocBinding(db: DatabaseType, docId: string, email: string): DocBinding | null {
  if (!isDocCopilotEnabled()) return null;
  const doc = getSharedDoc(db, docId);
  if (!doc) return null;
  const access = accessFor(db, docId, email, shareClearanceFor(email));
  if (!canComment(access)) return null;
  return { docId, docTitle: doc.title, access };
}
