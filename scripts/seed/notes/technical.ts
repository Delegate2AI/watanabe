/**
 * Demo KB notes: `02-research`, `04-economy`, `05-architecture`, `99-reference`.
 *
 * Fictional fixture content. These carry the `research`, `finance`, and
 * `engineering` clearances, so a viewer who is in none of them sees this whole
 * half of the tree simply not exist. The reference index links widely on
 * purpose: it gives most other notes a non-empty "Referenced by" list.
 */
import { ME } from "../roster";
import { ALEX, DEVON, MARIA, PRIYA, type VaultNote } from "./types";

export const TECHNICAL_NOTES: VaultNote[] = [
  {
    path: "02-research/liquidity-scenarios.md",
    title: "Liquidity Scenarios",
    owner: MARIA,
    updated: "2026-07-19",
    visibility: ["research"],
    body: `# Liquidity Scenarios

> Restricted to \`research\`. Inputs are synthetic.

Three scenarios feed every downstream model. They are deliberately coarse: the
point is to bound behavior, not to predict a number.

| Scenario | Depth assumption | Correlation | Used for |
|---|---|---|---|
| Base | Book absorbs a full clip inside the band | Stable | Tier assignment |
| Stress | Half the base depth, one venue offline | Elevated | Ceiling checks |
| Tail | Quarter depth, correlation goes to one | Broken | Survival only |

## What each scenario decides

- **Base** sets the default tier from
  [[../03-product/risk-tiers]].
- **Stress** sets the maximum leverage clamp.
- **Tail** does not size positions. It only answers "does the system stay
  solvent", which is why it is excluded from the emission work.

## Method

The construction rules are in [[depth-methodology]]. Do not tune a scenario
without changing the method note first; a scenario without a stated method is a
guess with a table around it.

## Open

- Should Stress assume one venue offline, or the worst venue offline?
- Tail correlation is a hard 1.0 today. That is convenient, not measured.`,
  },
  {
    path: "02-research/depth-methodology.md",
    title: "Depth Methodology",
    owner: MARIA,
    updated: "2026-07-13",
    visibility: ["research"],
    body: `# Depth Methodology

> Restricted to \`research\`.

How a depth band gets built, so the scenarios in [[liquidity-scenarios]] are
reproducible rather than remembered.

1. Sample the book at fixed intervals, not on trade events. Event sampling
   oversamples exactly the moments we care least about.
2. Measure absorbed size to a stated price threshold. Report the threshold with
   the number, always.
3. Drop the top and bottom sample by count, not by value.
4. Publish the sample count alongside the band. A band from six samples is a
   rumor.

## Known weaknesses

- Single owner. If Maria is out, nothing here gets refreshed
  (flagged in [[../01-strategy/board-update-q3]] for exec).
- Venue outages are modeled as absence, not as a queue.`,
  },
  {
    path: "02-research/market-scan.md",
    title: "Market Scan",
    owner: PRIYA,
    updated: "2026-07-09",
    visibility: ["all-hands"],
    body: `# Market Scan

Deliberately all-hands: a research folder where *every* note is restricted
teaches contributors that the folder is off limits. This one is not.

## What we watch

- Venue-native risk panels, and whether any of them start quoting depth
  honestly.
- Anyone publishing a scoring model with an explanation surface. That would
  change the calculus in [[../03-product/trader-score]].

## What we ignore

Volume leaderboards. They measure activity, which is not the thing.`,
  },
  {
    path: "04-economy/tokenomics.md",
    title: "Emission Design",
    owner: PRIYA,
    updated: "2026-07-17",
    visibility: ["finance"],
    body: `# Emission Design

> Restricted to \`finance\`. Every figure below is an illustrative placeholder.

Emission is flat today. This note argues for a decaying schedule tied to depth,
and lays out three candidate curves.

| Curve | Shape | Argument against |
|---|---|---|
| Linear decay | Predictable, easy to explain | Ignores conditions entirely |
| Depth-linked | Rewards the behavior we want | Depends on [[../02-research/depth-methodology]] holding up |
| Stepped | Simple to govern | Cliff behavior at each step |

## Status

Blocked. The depth inputs are not stable enough to model against; see the
deferral entry in [[../07-governance/decision-log]].

## Related

Fee interactions are in [[fee-model]].`,
  },
  {
    path: "04-economy/fee-model.md",
    title: "Fee Model",
    owner: PRIYA,
    updated: "2026-07-08",
    visibility: ["finance"],
    body: `# Fee Model

> Restricted to \`finance\`. Illustrative only.

Fees do two jobs: cover cost, and make farming unprofitable. When those conflict,
anti-farming wins.

## Structure

- A flat base component, so the cost side is predictable.
- A tier-sensitive component, so riskier books pay for the risk they add. Tiers
  come from [[../03-product/risk-tiers]].
- A rebate that decays with round-trip frequency, which is the anti-farming
  lever.

## Interaction with emissions

A rebate that outruns emission decay reintroduces exactly the farming loop the
decay was meant to close. Model the two together or not at all. See
[[tokenomics]].`,
  },
  {
    path: "05-architecture/system-overview.md",
    title: "System Overview",
    owner: DEVON,
    updated: "2026-07-20",
    visibility: ["engineering"],
    body: `# System Overview

> Restricted to \`engineering\`.

\`\`\`
 ingest ──▶ normalize ──▶ score ──▶ tier ──▶ surface
    │           │                    │
    └──▶ raw    └──▶ metrics         └──▶ audit log
\`\`\`

## Boundaries that matter

1. **Ingest never scores.** A scoring change must not require an ingest deploy.
2. **Tier is the only thing the product reads.** Everything upstream is an
   implementation detail; see [[../03-product/risk-tiers]].
3. **The audit log is append-only.** If a score changed, we can say why and when.

## Data flow detail

Per-stage contracts live in [[data-flows]].`,
  },
  {
    path: "05-architecture/data-flows.md",
    title: "Data Flows",
    owner: ALEX,
    updated: "2026-07-12",
    visibility: ["engineering"],
    body: `# Data Flows

> Restricted to \`engineering\`.

| Stage | Input | Output | Failure mode |
|---|---|---|---|
| Ingest | Venue feed | Raw events | Drop and alert; never interpolate |
| Normalize | Raw events | Canonical ticks | Reject unknown instrument |
| Score | Canonical ticks | Component scores | Emit null, not zero |
| Tier | Component scores | Tier + reason | Fail to the most conservative tier |

## The null rule

A missing component is null, never zero. Zero is a measurement; null is an
absence. Collapsing the two is how a thin book silently becomes a Tier A book.

Upstream picture: [[system-overview]].`,
  },
  {
    path: "99-reference/document-index.md",
    title: "Document Index",
    owner: ME,
    updated: "2026-07-22",
    visibility: ["all-hands"],
    body: `# Document Index

Every note in this demo vault, with its clearance. Notes you are not cleared for
are absent from your projection, so this list shrinks with your clearance: that
is the feature, not a rendering bug.

## Overview

- [[../00-overview/README]] - orientation (all-hands)
- [[../00-overview/glossary]] - vocabulary (all-hands)
- [[../00-overview/product-vision]] - what we are building (all-hands)

## Strategy

- [[../01-strategy/roadmap]] - status by workstream (all-hands)
- [[../01-strategy/positioning]] - the sentence (all-hands)
- [[../01-strategy/board-update-q3]] - quarterly ask (exec)

## Research

- [[../02-research/liquidity-scenarios]] - base / stress / tail (research)
- [[../02-research/depth-methodology]] - how bands are built (research)
- [[../02-research/market-scan]] - what we watch (all-hands)

## Product

- [[../03-product/risk-tiers]] - the tier table (all-hands)
- [[../03-product/trader-score]] - behavioral score (engineering)
- [[../03-product/onboarding-handbook]] - first week (all-hands, no frontmatter)

## Economy

- [[../04-economy/tokenomics]] - emission curves (finance)
- [[../04-economy/fee-model]] - fees and anti-farming (finance)

## Architecture

- [[../05-architecture/system-overview]] - stages and boundaries (engineering)
- [[../05-architecture/data-flows]] - per-stage contracts (engineering)

## Governance

- [[../07-governance/decision-log]] - what was decided (all-hands)
- [[../07-governance/access-policy]] - groups vs roles (admins)`,
  },
];
