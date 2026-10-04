/**
 * Seeds the newest document surfaces, none of which the old seeder touched:
 *
 * - Comment threads and replies (spec 2026-07-22), anchored and unanchored,
 *   open and resolved.
 * - Suggestions (proposed edits) in every terminal state: pending, accepted
 *   with an applied version, and rejected.
 * - External signed links (spec 28): active, comment-access, and expired.
 * - In-chat documents and the canvas pane (spec 29), including one promotion
 *   that has since diverged from its target.
 *
 * Anchors are built with the real `createAnchor()` over the exact document
 * body, so `resolveAnchor()` (rendered text) and `locateInSource()` (markdown
 * source) both find them instead of marking every seeded annotation stale.
 */
import type { Database as DatabaseType } from "better-sqlite3";
import { addReply, createThread, setThreadStatus } from "@/lib/db/comment-threads";
import { addVersion as addChatDocVersion, createDoc, recordPromotion } from "@/lib/db/chat-docs";
import { insertLink } from "@/lib/db/shared-doc-links";
import { createSuggestion, setSuggestionStatus } from "@/lib/db/suggestions";
import { createAnchor, type TextAnchor } from "@/lib/shared-docs/anchor";
import { HANDBOOK_BODY, ROADMAP_BODY } from "./db-docs";
import { ME, iso } from "./roster";

const DEVON = "devon.brooks@example.com";
const MARIA = "maria.chen@example.com";
const PRIYA = "priya.nair@example.com";

/** Anchor an exact quote inside `body`. Throws loudly if the seed drifts. */
function anchorFor(body: string, quote: string): TextAnchor {
  const index = body.indexOf(quote);
  if (index === -1) throw new Error(`seed anchor quote not found in body: "${quote}"`);
  return createAnchor(body, index, index + quote.length);
}

function seedCommentThreads(db: DatabaseType): void {
  // Anchored + open, with a reply: the common case.
  createThread(db, {
    id: "cth-handbook-visibility", docId: "doc-handbook",
    anchor: anchorFor(HANDBOOK_BODY, "A note you are not cleared for is absent"),
    createdBy: MARIA, createdAt: iso(10, 11),
    messageId: "cmsg-handbook-visibility-1",
    body: "Is this true for folders too, or only individual notes?",
  });
  addReply(db, {
    id: "cmsg-handbook-visibility-2", threadId: "cth-handbook-visibility", docId: "doc-handbook",
    authorEmail: ME, body: "Folders too. A folder with no visible notes does not render at all.",
    createdAt: iso(10, 15),
  });

  // Anchored + resolved: exercises the resolved styling and the resolver name.
  createThread(db, {
    id: "cth-handbook-proposal", docId: "doc-handbook",
    // Quotes must not span a source line break: the UI resolves anchors over
    // RENDERED text, where a hard-wrapped newline has become a single space.
    anchor: anchorFor(HANDBOOK_BODY, "save it as an artifact, then publish"),
    createdBy: DEVON, createdAt: iso(12, 10),
    messageId: "cmsg-handbook-proposal-1",
    body: "Worth saying explicitly that nothing auto-merges.",
  });
  addReply(db, {
    id: "cmsg-handbook-proposal-2", threadId: "cth-handbook-proposal", docId: "doc-handbook",
    authorEmail: ME, body: "Added in the next sentence. Resolving.", createdAt: iso(12, 12),
  });
  setThreadStatus(db, "cth-handbook-proposal", "doc-handbook", "resolved", ME, iso(12, 12));

  // Unanchored (document-level) thread on a doc someone else owns.
  createThread(db, {
    id: "cth-roadmap-sequencing", docId: "doc-research-roadmap", anchor: null,
    createdBy: ME, createdAt: iso(18, 9),
    messageId: "cmsg-roadmap-sequencing-1",
    body: "Does this sequencing still match the risk framework timeline after the tier change?",
  });
  addReply(db, {
    id: "cmsg-roadmap-sequencing-2", threadId: "cth-roadmap-sequencing", docId: "doc-research-roadmap",
    authorEmail: PRIYA, body: "It does. The tier change moved a ceiling, not the depth inputs.",
    createdAt: iso(18, 14),
  });

  createThread(db, {
    id: "cth-roadmap-depth", docId: "doc-research-roadmap",
    anchor: anchorFor(ROADMAP_BODY, "too conservative"),
    createdBy: MARIA, createdAt: iso(19, 10),
    messageId: "cmsg-roadmap-depth-1",
    body: "Not conservative enough, if anything. One bad quote and we lose the argument.",
  });
}

function seedSuggestions(db: DatabaseType): void {
  // Pending: shows the accept / reject controls.
  createSuggestion(db, {
    id: "sug-handbook-review", docId: "doc-handbook", baseVersion: 2,
    anchor: anchorFor(HANDBOOK_BODY, "approvers can publish directly when a change does not"),
    originalText: "approvers can publish directly when a change does not",
    proposedText: "an approver can publish directly when a change does not",
    note: "\"Review\" is ambiguous. Name the actual gate.",
    createdBy: MARIA, createdAt: iso(17, 10),
  });

  // Accepted, with the version the splice landed in.
  createSuggestion(db, {
    id: "sug-handbook-locked", docId: "doc-handbook", baseVersion: 1,
    anchor: anchorFor(HANDBOOK_BODY, "rather than shown as locked"),
    originalText: "rather than shown as locked",
    proposedText: "rather than shown as a locked placeholder",
    note: null,
    createdBy: DEVON, createdAt: iso(15, 9),
  });
  setSuggestionStatus(db, "sug-handbook-locked", "accepted", ME, iso(16, 9), 2);

  // Rejected, so the resolved-but-not-applied path has a row.
  createSuggestion(db, {
    id: "sug-roadmap-order", docId: "doc-research-roadmap", baseVersion: 1,
    anchor: anchorFor(ROADMAP_BODY, "liquidity modeling first, then emission design"),
    originalText: "liquidity modeling first, then emission design",
    proposedText: "emission design first, then liquidity modeling",
    note: "Could we parallelize instead?",
    createdBy: ME, createdAt: iso(14, 11),
  });
  setSuggestionStatus(db, "sug-roadmap-order", "rejected", PRIYA, iso(15, 11), null);
}

function seedExternalLinks(db: DatabaseType): void {
  insertLink(db, { token: "demo-handbook-view-token", docId: "doc-handbook", access: "view", expiresAt: null }, iso(12));
  insertLink(db, { token: "demo-release-comment-token", docId: "doc-release-notes", access: "comment", expiresAt: iso(31) }, iso(13));
  // Already expired: the external view must refuse this one.
  insertLink(db, { token: "demo-tier-expired-token", docId: "doc-tier-review", access: "view", expiresAt: iso(15) }, iso(13));
}

function seedChatDocs(db: DatabaseType): void {
  createDoc(db, {
    id: "cdoc-tier-summary", threadId: "thread-risk-model", ownerEmail: ME,
    title: "Tier model summary",
    body: "# Tier model summary\n\nThree tiers, each with a collateral factor and a leverage ceiling. The ceiling is the product of depth band and correlation penalty.",
  }, iso(12, 15));
  addChatDocVersion(db, "cdoc-tier-summary", ME,
    "# Tier model summary\n\nThree tiers, each with a collateral factor and a leverage ceiling. The ceiling is the product of depth band and correlation penalty.\n\nTier C now caps at 1.5x. The tail scenario never sizes a position; it only answers whether the system stays solvent.",
    { now: iso(20, 10) });
  // Promoted at target version 1, but the artifact has since gained version 2:
  // this is the divergence case the canvas warns about.
  recordPromotion(db, {
    docId: "cdoc-tier-summary", ownerEmail: ME, targetType: "artifact",
    targetId: "art-risk-tier", promotedVersion: 1, targetVersionAtPromote: 1,
  }, iso(12, 16));

  createDoc(db, {
    id: "cdoc-onboarding-checklist", threadId: "thread-onboarding", ownerEmail: ME,
    title: "Onboarding checklist",
    body: "# Onboarding checklist\n\n- [ ] Read the overview and the glossary\n- [ ] Claim a task from the board\n- [ ] Draft a change in chat\n- [ ] Publish it as a merge request",
  }, iso(12, 16));
  recordPromotion(db, {
    docId: "cdoc-onboarding-checklist", ownerEmail: ME, targetType: "shared_doc",
    targetId: "doc-handbook", promotedVersion: 1, targetVersionAtPromote: 2,
  }, iso(16, 12));

  createDoc(db, {
    id: "cdoc-scenario-compare", threadId: "thread-liquidity", ownerEmail: ME,
    title: "Scenario comparison",
    body: "# Scenario comparison\n\nBase, stress, tail. Draft one: structure only, no numbers.",
  }, iso(13, 15));
  addChatDocVersion(db, "cdoc-scenario-compare", ME,
    "# Scenario comparison\n\n| Scenario | Depth | Correlation |\n|---|---|---|\n| Base | full | stable |\n| Stress | half | elevated |\n| Tail | quarter | broken |",
    { now: iso(13, 17) });
  addChatDocVersion(db, "cdoc-scenario-compare", ME,
    "# Scenario comparison\n\n| Scenario | Depth | Correlation | Decides |\n|---|---|---|---|\n| Base | full | stable | default tier |\n| Stress | half | elevated | leverage clamp |\n| Tail | quarter | broken | solvency only |",
    { now: iso(19, 11) });

  createDoc(db, {
    id: "cdoc-access-notes", threadId: "thread-access", ownerEmail: ME,
    title: "Groups vs roles, in one page",
    body: "# Groups vs roles\n\n**Groups** decide what you see. **Roles** decide what you may write. Orthogonal on purpose: an admins-group member is not automatically an admin-role holder.",
  }, iso(18, 16));
}

export function seedAnnotations(db: DatabaseType): void {
  seedCommentThreads(db);
  seedSuggestions(db);
  seedExternalLinks(db);
  seedChatDocs(db);
}
