/**
 * Seeds the document surfaces: artifacts (spec 27) and shared docs (spec 28).
 *
 * Artifacts cover all three states, including `published`, whose
 * `published_note_path` points at a note that really exists in the generated
 * demo vault. Shared docs cover both directions (shared by me / shared with me)
 * and all three access levels, plus multi-version history so the version list
 * is not a single row.
 *
 * The bodies are exported because the annotation seed (`db-annotations.ts`)
 * anchors comments and suggestions into them by exact substring.
 */
import type { Database as DatabaseType } from "better-sqlite3";
import { addVersion as addArtifactVersion, insertArtifact, markPublished, updateArtifact } from "@/lib/db/artifacts";
import { addComment, addVersion as addDocVersion, insertSharedDoc, upsertShare } from "@/lib/db/shared-docs";
import { ME, iso } from "./roster";

const DEVON = "devon.brooks@example.com";
const MARIA = "maria.chen@example.com";
const PRIYA = "priya.nair@example.com";
const SAM = "sam.rivera@example.com";

const ARTIFACTS = [
  {
    id: "art-risk-tier", title: "Risk Tier Table v2", status: "ready" as const, day: 11,
    thread: "thread-risk-model",
    body: `# Risk Tier Table v2\n\n| Tier | Collateral factor | Max leverage |\n|------|-------------------|--------------|\n| A | 0.90 | 5x |\n| B | 0.75 | 3x |\n| C | 0.50 | 2x |\n\nDerived from the 2026-07-02 risk guild decision. Pending review by the guild.`,
  },
  {
    id: "art-onboarding-guide", title: "Contributor Onboarding Guide", status: "draft" as const, day: 12,
    thread: "thread-onboarding",
    body: `# Contributor Onboarding Guide (draft)\n\n1. Read the KB overview.\n2. Pick a task from your inbox.\n3. Draft a change and save it as an artifact.\n4. Publish the artifact to open a merge request.\n\n_TODO: add screenshots._`,
  },
  {
    id: "art-tokenomics-brief", title: "Tokenomics Brief", status: "ready" as const, day: 15,
    thread: "thread-emissions",
    body: `# Tokenomics Brief\n\nEmission is flat today. This brief argues for a decaying schedule tied to depth, with three candidate curves to model.\n\nBlocked on the depth inputs, so treat every figure as a placeholder.`,
  },
  {
    id: "art-liquidity-notes", title: "Orbit Liquidity Notes", status: "draft" as const, day: 13,
    thread: "thread-liquidity",
    body: `# Orbit Liquidity Notes (draft)\n\nRough notes on depth across the base, stress, and tail scenarios. Numbers are placeholders until the model runs.`,
  },
  {
    id: "art-access-explainer", title: "Groups vs Roles Explainer", status: "published" as const, day: 14,
    thread: "thread-access",
    published: "07-governance/access-policy.md",
    body: `# Groups vs Roles\n\nGroups are clearance: what you may see. Roles are capability: what you may write. They are orthogonal, and confusing them is the most common access mistake.`,
  },
];

/** Shared-doc bodies, exported so annotations can anchor into the exact text. */
export const HANDBOOK_BODY = `# Contributor Handbook

The living guide for the Orbit contributor community. Comment inline with
questions and leave a suggestion when you think the wording is wrong.

## Making your first proposal

Draft the change in chat, save it as an artifact, then publish. Publishing opens
a merge request, and approvers can publish directly when a change does not
need review.

## Visibility

Every note carries a visibility list. A note you are not cleared for is absent
from your tree entirely, rather than shown as locked.`;

export const ROADMAP_BODY = `# Research Roadmap H2

Priorities in order: liquidity modeling first, then emission design. The second
depends on the first, so slipping the depth work slips everything after it.

## Sequencing

Depth methodology has to land before any scenario numbers get quoted downstream.
Feedback welcome on whether that ordering is too conservative.`;

const SHARED_DOCS = [
  {
    id: "doc-handbook", title: "Contributor Handbook", owner: ME, day: 9, body: HANDBOOK_BODY,
    shares: [[MARIA, "comment"], [DEVON, "edit"], [SAM, "view"]] as const,
    // Version 2 carries the splice from the accepted suggestion in
    // `db-annotations.ts` (`sug-handbook-locked`), so the resolved suggestion
    // and the current body actually agree.
    revision: {
      day: 16, author: DEVON,
      body: `${HANDBOOK_BODY.replace("rather than shown as locked", "rather than shown as a locked placeholder")}\n\n## Getting unstuck\n\nAsk in chat first. The agent can see every note you are cleared for.`,
    },
  },
  {
    id: "doc-release-notes", title: "Release Notes v0.9", owner: ME, day: 11,
    body: `# Release Notes v0.9\n\n- New Tasks board with an in-progress lane\n- Shared docs with inline comments and suggestions\n- Artifact publishing through the write path\n- KB access administration`,
    shares: [[PRIYA, "view"], [SAM, "view"]] as const,
    revision: null,
  },
  {
    id: "doc-tier-review", title: "Tier Review Working Doc", owner: ME, day: 13,
    body: `# Tier Review Working Doc\n\nScratch space for the tier discussion. The contested number is the Tier C ceiling: 2x held under the base scenario only.`,
    shares: [[DEVON, "edit"], [MARIA, "comment"]] as const,
    revision: { day: 19, author: ME, body: `# Tier Review Working Doc\n\nScratch space for the tier discussion. The contested number is the Tier C ceiling: 2x held under the base scenario only.\n\n**Resolved 2026-07-20:** ceiling moves to 1.5x for everyone rather than special-casing the tail.` },
  },
  // Owned by others, shared to me -> the "Shared with me" list.
  {
    id: "doc-research-roadmap", title: "Research Roadmap H2", owner: PRIYA, day: 7, body: ROADMAP_BODY,
    shares: [[ME, "edit"], [MARIA, "comment"]] as const,
    revision: { day: 18, author: PRIYA, body: `${ROADMAP_BODY}\n\n## Open question\n\nShould the tail scenario block emission work at all, given it never sizes a position?` },
  },
  {
    id: "doc-budget", title: "Budget Overview Q3", owner: SAM, day: 5,
    body: `# Budget Overview Q3\n\nHigh-level allocation across guilds. View-only for most contributors; the numbers here are illustrative placeholders.`,
    shares: [[ME, "view"], [PRIYA, "view"]] as const,
    revision: null,
  },
  {
    id: "doc-ingest-postmortem", title: "Ingest Postmortem", owner: DEVON, day: 20,
    body: `# Ingest Postmortem\n\nA thin book was tiered A for eleven minutes because a missing depth component was written as zero instead of null.\n\n## Fix\n\nNull means absence. Zero means a measurement. The scorer now emits null and tiering fails to the most conservative tier.`,
    shares: [[ME, "comment"]] as const,
    revision: null,
  },
];

export function seedDocs(db: DatabaseType): void {
  for (const a of ARTIFACTS) {
    insertArtifact(db, { id: a.id, title: a.title, ownerEmail: ME, sourceThreadId: a.thread, body: a.body }, iso(a.day));
    if (a.status === "ready") updateArtifact(db, a.id, ME, { status: "ready" });
    if (a.status === "published") {
      updateArtifact(db, a.id, ME, { status: "ready" });
      // No merge request: the seeded artifacts are direct publishes.
      markPublished(db, a.id, ME, a.published!, "published", null, iso(a.day + 1));
    }
  }
  // Version history on one artifact, so the version list is not a single row.
  addArtifactVersion(db, "art-risk-tier", ME, "# Risk Tier Table v2.1\n\nTightened Tier C max leverage to 1.5x after the guild review. Everything else unchanged.", { now: iso(20) });

  for (const d of SHARED_DOCS) {
    insertSharedDoc(db, { id: d.id, title: d.title, ownerEmail: d.owner, body: d.body }, iso(d.day));
    for (const [recipient, access] of d.shares) {
      upsertShare(db, d.id, recipient, access, iso(d.day));
    }
    if (d.revision) addDocVersion(db, d.id, d.revision.author, d.revision.body, { now: iso(d.revision.day) });
  }

  // Legacy unanchored comments (the pre-annotation `doc_comments` surface).
  addComment(db, { id: "cmt-handbook-1", docId: "doc-handbook", authorEmail: MARIA, body: "Can we add a section on how visibility groups work?", anchor: null }, iso(10));
  addComment(db, { id: "cmt-roadmap-1", docId: "doc-research-roadmap", authorEmail: PRIYA, body: "@taylor.reed does the sequencing here match the risk framework timeline?", anchor: null }, iso(8));
  addComment(db, { id: "cmt-budget-1", docId: "doc-budget", authorEmail: SAM, body: "View-only on purpose. Ask me if you need edit access.", anchor: null }, iso(6));
}
