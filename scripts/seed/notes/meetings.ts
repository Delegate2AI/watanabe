/**
 * Demo meeting notes, read file-first by `lib/meetings/list.ts` (NOT from the
 * DB): it scans `<vault>/meetings/**.md` and keeps files whose frontmatter has
 * `type: meeting` plus a `date`.
 *
 * Clearance follows the spec-20 rule that drives the real ingester: it is
 * derived from the attendees and never widens on uncertainty. A meeting whose
 * attendees all share one group is filed at that group; a mixed-group meeting
 * falls back to all-hands only because everyone present is in all-hands.
 *
 * The action items here are the source rows for the seeded tasks, so the
 * `sourceMeetingId` / `sourceNotePath` on a task resolves to a real note.
 */
import { ME } from "../roster";
import { ALEX, DEVON, MARIA, PRIYA, SAM, type VaultNote } from "./types";

/** `meetings/<id>.md` -- the id a seeded task's `sourceMeetingId` points at. */
export const MEETING_IDS = {
  riskGuild: "2026-07-02-risk-guild",
  researchSync: "2026-07-06-research-sync",
  standup: "2026-07-10-standup",
  tokenomics: "2026-07-15-tokenomics-review",
  execReview: "2026-07-17-exec-review",
  onboardingRetro: "2026-07-21-onboarding-retro",
} as const;

function meeting(input: {
  id: string;
  title: string;
  date: string;
  minutes: number;
  attendees: string[];
  visibility: string[];
  body: string;
}): VaultNote {
  return {
    path: `meetings/${input.id}.md`,
    title: input.title,
    owner: ME,
    updated: input.date,
    visibility: input.visibility,
    extra: {
      type: "meeting",
      date: input.date,
      duration_minutes: input.minutes,
      attendees: input.attendees,
    },
    body: input.body,
  };
}

export const MEETING_NOTES: VaultNote[] = [
  meeting({
    id: MEETING_IDS.riskGuild,
    title: "Risk Guild Sync",
    date: "2026-07-02",
    minutes: 45,
    attendees: [ME, DEVON, ALEX],
    visibility: ["engineering"],
    body: `# Risk Guild Sync

## Summary

Walked the tier boundaries end to end. Agreement that the whiteboard model is
good enough to write down, not good enough to ship.

## Notes

- Tier C behaves badly whenever depth thins and correlation rises together.
- The clamp logic belongs in tiering, not in scoring. Scoring should stay
  descriptive.

## Action items

- Draft the new risk-tier table (owner: taylor)
- Move the clamp out of the scorer (owner: devon)`,
  }),
  meeting({
    id: MEETING_IDS.researchSync,
    title: "Research Sync",
    date: "2026-07-06",
    minutes: 30,
    attendees: [MARIA, PRIYA],
    visibility: ["research"],
    body: `# Research Sync

## Summary

Scoped the three scenarios and agreed the method note has to land before any
numbers are quoted downstream.

## Notes

- Stress will assume one venue offline. Which venue is still open.
- Tail is a solvency check only. It does not size anything.

## Action items

- Collect liquidity scenario inputs (owner: maria)
- Write up the depth sampling method (owner: maria)`,
  }),
  meeting({
    id: MEETING_IDS.standup,
    title: "Weekly Orbit Standup",
    date: "2026-07-10",
    minutes: 30,
    attendees: [ME, DEVON, MARIA, PRIYA, SAM, ALEX],
    visibility: ["all-hands"],
    body: `# Weekly Orbit Standup

## Summary

Everyone present, so this note is all-hands. Covered the Q3 rebalance timeline
and the liquidity refresh. Two action items came out of the tier discussion.

## Notes

- Risk tiers from the whiteboard need to become a proper table in the docs.
- Several overview links point at notes that were renamed.
- Onboarding is the recurring complaint from the last two new joiners.

## Action items

- Clean up stale overview links (owner: unassigned)
- Outline the contributor handbook (owner: devon)
- File this week's standup actions into the tracker (owner: unassigned)`,
  }),
  meeting({
    id: MEETING_IDS.tokenomics,
    title: "Tokenomics Review",
    date: "2026-07-15",
    minutes: 60,
    attendees: [PRIYA, SAM],
    visibility: ["finance"],
    body: `# Tokenomics Review

## Summary

Three emission curves compared. No decision: the depth inputs the depth-linked
curve needs are not stable yet.

## Notes

- Linear decay is the fallback if the depth work slips again.
- The rebate schedule has to be modeled together with emissions, not after.

## Action items

- Sketch the emission schedule options (owner: priya)
- Model rebate and emission interaction together (owner: priya)`,
  }),
  meeting({
    id: MEETING_IDS.execReview,
    title: "Exec Review",
    date: "2026-07-17",
    minutes: 45,
    attendees: [ME, SAM],
    visibility: ["exec"],
    body: `# Exec Review

> Exec clearance. Attendees are both in \`exec\`, so the note is filed there and
> nobody else sees it in the tree.

## Summary

Agreed to defer the emission redesign one cycle rather than model against inputs
we do not trust.

## Notes

- Depth methodology being single-owner is the risk we are most exposed to.
- Two research contributors requested; decision at the next board slot.

## Action items

- Draft the Q3 board update (owner: taylor)`,
  }),
  meeting({
    id: MEETING_IDS.onboardingRetro,
    title: "Onboarding Retro",
    date: "2026-07-21",
    minutes: 30,
    attendees: [ME, DEVON, MARIA],
    visibility: ["all-hands"],
    body: `# Onboarding Retro

## Summary

Retro on the last two joiners. The handbook exists but nothing points at it, and
the glossary is where people actually start.

## Notes

- "Where do I put this?" is the most common first-week question.
- Nobody found the artifact-to-merge-request flow without being shown.

## Action items

- Start a Orbit glossary section for new terms (owner: unassigned)
- Link the handbook from the overview README (owner: devon)`,
  }),
];
