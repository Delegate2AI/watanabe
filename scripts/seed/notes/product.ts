/**
 * Demo KB notes: `03-product` and `07-governance`.
 *
 * Fictional fixture content. This is where the clearance spread lives: an
 * all-hands note, an engineering-only note, an admins-only note, and one note
 * with no frontmatter at all (the KB access admin reports it as skipped).
 */
import { ME } from "../roster";
import { DEVON, type VaultNote } from "./types";

export const PRODUCT_NOTES: VaultNote[] = [
  {
    path: "03-product/risk-tiers.md",
    title: "Risk Tier Model",
    owner: ME,
    updated: "2026-07-20",
    visibility: ["all-hands"],
    body: `# Risk Tier Model

The tier table is the single reference every other surface reads. Changing a
number here changes product behavior, so changes go through review.

## Tiers

| Tier | Collateral factor | Max leverage | Typical use |
|---|---|---|---|
| A | 0.90 | 5x | Deep, correlated-stable books |
| B | 0.75 | 3x | Normal conditions |
| C | 0.50 | 1.5x | Thin depth or unstable correlation |

Tier C dropped from 2x to 1.5x after the 2026-07-10 review. The reasoning is in
the [decision log](../07-governance/decision-log.md).

## How a position gets a tier

1. Resolve the instrument's depth band from
   [[../02-research/liquidity-scenarios]].
2. Apply the correlation penalty.
3. Clamp to the trader's own ceiling if [[trader-score]] applies one.

## Open questions

- Should tier boundaries move with realized volatility, or stay fixed and let
  the correlation penalty absorb the movement?
- Do we publish the factors, or only the resulting tier?`,
  },
  {
    path: "03-product/trader-score.md",
    title: "Trader Score",
    owner: DEVON,
    updated: "2026-07-18",
    visibility: ["engineering"],
    body: `# Trader Score

> Restricted to \`engineering\` while the weights are still moving. Do not quote
> these numbers outside the guild.

A composite behavioral score, illustrative weights only:

\`\`\`json
{
  "drawdown_discipline": 0.35,
  "sizing_consistency": 0.30,
  "hold_time_stability": 0.20,
  "venue_diversity": 0.15
}
\`\`\`

## Why it is restricted

A published weighting is a published optimization target. Until we have an
explanation surface (see [Roadmap](../01-strategy/roadmap.md)), the score stays
internal.

## Interaction with tiers

The score never raises a tier. It can only clamp one downward, which keeps
[[risk-tiers]] the ceiling rather than a suggestion.`,
  },
  {
    // Deliberately frontmatter-less: exercises the KB access admin's "skipped"
    // path (rewriteVisibility() returns null when there is no `---` block) and
    // the all-hands default for a note with no metadata at all.
    path: "03-product/onboarding-handbook.md",
    title: "Contributor Onboarding Handbook",
    owner: DEVON,
    updated: "2026-07-16",
    visibility: null,
    noFrontmatter: true,
    body: `# Contributor Onboarding Handbook

This note has no frontmatter on purpose. It reads as \`all-hands\`, and the KB
access admin reports it as *skipped* rather than rewriting it, because there is
no frontmatter block to edit.

## Your first week

1. Read [[../00-overview/README]] and [[../00-overview/glossary]].
2. Pick a task from your inbox on \`/tasks\`.
3. Draft the change in chat and save it as an artifact.
4. Publishing normally opens a merge request. Approvers can publish directly
   when a change does not need review.

## Conventions

- One idea per note. Link rather than repeat.
- Put the decision in the [decision log](../07-governance/decision-log.md), the
  reasoning in the note.
- No note is private by being unlinked. Use \`visibility:\` instead.`,
  },
  {
    path: "07-governance/decision-log.md",
    title: "Decision Log",
    owner: ME,
    updated: "2026-07-21",
    visibility: ["all-hands"],
    body: `# Decision Log

Newest first. One entry per decision, with who decided and what it changed.

## 2026-07-20 - Tier C max leverage drops to 1.5x

**Decided by:** risk guild. **Changes:** [[../03-product/risk-tiers]].
Stress runs showed the 2x ceiling only held under the base scenario. Rather than
special-case the tail, the ceiling moved for everyone.

## 2026-07-17 - Emission redesign deferred one cycle

**Decided by:** exec. **Changes:** [Roadmap](../01-strategy/roadmap.md).
The depth inputs are not stable enough to model against yet.

## 2026-07-12 - Trader score stays engineering-only

**Decided by:** engineering guild. **Changes:**
[[../03-product/trader-score]] visibility. Publishing a weighting publishes an
optimization target; we need the explanation surface first.

## 2026-07-06 - Meeting notes derive clearance from attendees

**Decided by:** admins. **Changes:** [[access-policy]]. Clearance never widens
on uncertainty: an unrecognized attendee narrows the note rather than opening it.`,
  },
  {
    path: "07-governance/access-policy.md",
    title: "Access Policy",
    owner: ME,
    updated: "2026-07-14",
    visibility: ["admins"],
    body: `# Access Policy

> Restricted to \`admins\`.

## Two orthogonal concepts

**Groups** are clearance: what content an identity may *see*. They live in
\`access/groups.yaml\`.

**Roles** are capability: what an identity may *write*. They live in
\`access/roles.yaml\` and are checked by \`can()\`.

A person can be in \`admins\` (sees everything) without holding the \`admin\`
role (may change membership), and the reverse. Confusing the two is the most
common mistake when granting access.

## Rules

1. Clearance never widens on uncertainty. An unresolvable attendee narrows a
   meeting note.
2. Absence is the boundary. A restricted note is missing from the projection,
   not locked in the tree.
3. Every membership change is a git commit authored by the admin who made it.
4. \`all-hands\` is an explicit group here, not just an implicit fallback, so
   the access admin can set a note back to it.

Related: [[decision-log]], [[../00-overview/glossary]].`,
  },
];
