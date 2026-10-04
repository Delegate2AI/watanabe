import { ME } from "../roster";
import { MARIA, SAM, type VaultNote } from "./types";

export const OVERVIEW_NOTES: VaultNote[] = [
  {
    path: "00-overview/README.md",
    title: "Demo Vault Overview",
    owner: ME,
    updated: "2026-07-22",
    // No `visibility:` key at all: readVisibility() defaults this to all-hands,
    // which is what almost every note in the real vault looks like today.
    visibility: null,
    body: `# Demo Vault Overview

> **This is a generated demo vault.** Everything here is fixture content written
> by \`scripts/seed-demo.ts\` for local dogfooding. Names, numbers, and decisions
> are invented. Nothing in this vault is real Meridian material.

## Where things are

| Folder | Holds | Typical clearance |
|---|---|---|
| \`00-overview\` | Orientation, glossary, vision | all-hands |
| \`01-strategy\` | Positioning, roadmap, board material | all-hands + exec |
| \`02-research\` | Scenario work and methodology | research |
| \`03-product\` | Risk tiers, scoring, onboarding | all-hands + engineering |
| \`04-economy\` | Emissions, fees, treasury | finance |
| \`05-architecture\` | Systems and data flow | engineering |
| \`07-governance\` | Decisions and access policy | all-hands + admins |
| \`meetings\` | Ingested meeting notes | derived from attendees |

## Start here

- [[glossary]] for the vocabulary.
- [[product-vision]] for what we are building.
- [Roadmap](../01-strategy/roadmap.md) for what lands when.
- [[../03-product/risk-tiers]] for the tier model everything else references.

If a note you expect is missing, you are not cleared for it. Absence is the
boundary: the KB never shows a locked placeholder.`,
  },
  {
    path: "00-overview/glossary.md",
    title: "Glossary",
    owner: MARIA,
    updated: "2026-07-19",
    visibility: ["all-hands"],
    body: `# Glossary

Terms new contributors keep asking about. Add rather than rewrite: if a
definition is wrong, propose the fix through a merge request.

## Clearance

The set of groups an identity belongs to. Resolved from \`access/groups.yaml\`
and always includes \`all-hands\`. See [[../07-governance/access-policy]].

## Depth

How much size a market absorbs before price moves past a stated threshold.
The scenario work lives in [[../02-research/liquidity-scenarios]].

## Projection

A materialized copy of the vault containing only the notes one clearance set may
read. The app serves reads from a projection, never from the raw vault.

## Risk tier

A collateral bucket. Tiers set collateral factor and maximum leverage; see
[Risk tiers](../03-product/risk-tiers.md).

## Trader score

The composite behavioral score described in [[../03-product/trader-score]].
Engineering-only while the weighting is still moving.

## Vault

The markdown knowledge base itself: the \`docs/\` tree in the KB repo.`,
  },
  {
    path: "00-overview/product-vision.md",
    title: "Product Vision",
    owner: ME,
    updated: "2026-07-15",
    visibility: ["all-hands"],
    body: `# Product Vision

Orbit should let a trader understand their own risk before the market explains
it to them.

## The three commitments

1. **Legible risk.** Every position maps to a tier a person can explain out
   loud. No score without a stated reason. See [[../03-product/risk-tiers]].
2. **Honest depth.** We quote what the book can actually absorb, not what the
   mid price implies. See [Liquidity scenarios](../02-research/liquidity-scenarios.md).
3. **Durable incentives.** Rewards decay toward the behavior we want repeated,
   not toward whoever arrived first.

## What we are not building

- A leaderboard that rewards volume for its own sake.
- A closed scoring model. If we cannot explain a score, we do not ship it.
- Anything that needs a support ticket to reverse.

## How this connects

The vision drives the [roadmap](../01-strategy/roadmap.md) and gets tested
against the [decision log](../07-governance/decision-log.md) every quarter.`,
  },
  {
    path: "01-strategy/roadmap.md",
    title: "Roadmap and Status",
    owner: ME,
    updated: "2026-07-21",
    visibility: ["all-hands"],
    body: `# Roadmap and Status

Illustrative planning fixture. Statuses are made up.

| Workstream | Status | Owner | Depends on |
|---|---|---|---|
| Risk tier model v2 | In review | Taylor | [[../03-product/risk-tiers]] |
| Liquidity scenarios | In progress | Maria | Depth methodology |
| Emission redesign | Blocked | Priya | Liquidity scenarios |
| Contributor onboarding | In progress | Devon | none |
| Access policy rollout | Done | Taylor | [[../07-governance/access-policy]] |

## Now

- Close the tier table review and fold the comments back into the note.
- Land the three stress scenarios so the emission work can unblock.

## Next

- Rewrite [[positioning]] once the tier language settles.
- Decide whether trader score ships behind a flag or not at all this quarter.

## Not now

- Cross-venue routing. Revisit after depth work concludes.
- Public score explanations. Waiting on the model to stop moving.`,
  },
  {
    path: "01-strategy/positioning.md",
    title: "Positioning",
    owner: SAM,
    updated: "2026-07-11",
    visibility: ["all-hands"],
    body: `# Positioning

## The sentence

For active traders who cannot see their own tail risk, Orbit is a risk surface
that prices the position they actually hold.

## Against the alternatives

- **Spreadsheets.** Faster to start, impossible to keep honest once positions
  move intraday.
- **Venue-native risk panels.** Accurate for that venue only, and silent about
  the correlation between venues.
- **Do nothing.** Works right up until it does not.

## Language we use

"Tier", not "grade". "Depth", not "liquidity" on its own. The vocabulary is
pinned in [[../00-overview/glossary]] so the docs and the product agree.`,
  },
  {
    path: "01-strategy/board-update-q3.md",
    title: "Board Update Q3 (draft)",
    owner: ME,
    updated: "2026-07-17",
    visibility: ["exec"],
    body: `# Board Update Q3 (draft)

> Restricted to \`exec\`. Visible here only because you are cleared. A
> contributor without exec clearance does not see this file in the tree at all.

## Headline

Risk tiering moved from a whiteboard to a reviewed model this quarter. The
emission redesign slipped, gated on depth work that is still running.

## Asks

1. Confirm the emission decision can wait one more cycle.
2. Approve two additional research contributors.

## Risks we are carrying

- Depth methodology is single-owner. Bus factor of one.
- Trader score has no external review yet; see
  [[../03-product/trader-score]] (engineering clearance).`,
  },
];
