/**
 * Seeds the "work" half of the portal DB: projects, threads, the task board,
 * and the links between them (project threads, project tasks, project docs).
 *
 * Task coverage is deliberate. Every `TaskStatus` appears at least once
 * (`proposed` / `open` / `in_progress` / `done` / `dismissed`), both origins are
 * represented (`circleback` meeting-derived and `manual` board-created), and
 * assignees are spread across the roster so the board's reassign control has
 * somewhere to move work to.
 *
 * Clearance note: two tasks are filed at `research` / `finance`, which the dev
 * identity is NOT in. They are correctly invisible on the board. That is the
 * feature, not missing seed data.
 */
import type { Database as DatabaseType } from "better-sqlite3";
import { insertProjectDocument } from "@/lib/db/project-docs";
import { attachTask, attachThread, createProject } from "@/lib/db/projects";
import { insertProposed, setStatus, type TaskStatus } from "@/lib/db/tasks";
import { recordThread } from "@/lib/db/threads";
import { writeProjectDocument } from "@/lib/projects/doc-store";
import { MEETING_IDS } from "./notes/meetings";
import { ALL, ME, clearanceOf, iso } from "./roster";

const DEVON = "devon.brooks@example.com";
const MARIA = "maria.chen@example.com";
const PRIYA = "priya.nair@example.com";
const ALEX = "alex.kim@example.com";

const ENG = ["all-hands", "engineering"];

const PROJECTS = [
  { id: "proj-risk-framework", name: "Meridian Risk Framework", description: "Define and document the risk-tier model powering Orbit.", context: "Owner: risk guild. The tier table in 03-product/risk-tiers.md is the source of truth; this project tracks the work around it.", clearance: ALL, day: 2 },
  { id: "proj-orbit-liquidity", name: "Orbit Liquidity Model", description: "Model liquidity depth across market scenarios.", context: "Scenario inputs live in 02-research. Outputs feed the risk framework and gate the emission work.", clearance: ["all-hands", "research"], day: 4 },
  { id: "proj-onboarding", name: "Q3 Contributor Onboarding", description: "Everything a new contributor needs to make their first proposal.", context: "Deliverable: a handbook artifact plus a shared checklist. Driven by the 2026-07-21 retro.", clearance: ALL, day: 6 },
  { id: "proj-tokenomics", name: "Tokenomics Revamp", description: "Revisit emission schedule and incentive weights.", context: "Blocked on the liquidity model. Drafts are collected as artifacts before anything reaches the KB.", clearance: ["all-hands", "finance"], day: 8 },
  { id: "proj-platform", name: "Platform Hardening", description: "Reliability and access work on the portal itself.", context: "Engineering-only. Covers the access admin rollout and the ingest null-handling rule.", clearance: ENG, day: 9 },
];

const THREADS = [
  { id: "thread-risk-model", title: "Explain the risk tier model", day: 12, project: "proj-risk-framework" },
  { id: "thread-onboarding", title: "Draft an onboarding checklist", day: 12, project: "proj-onboarding" },
  { id: "thread-standup", title: "Summarize the Orbit standup", day: 13, project: null },
  { id: "thread-liquidity", title: "Compare liquidity scenarios", day: 13, project: "proj-orbit-liquidity" },
  { id: "thread-emissions", title: "Which emission curve survives the stress case?", day: 15, project: "proj-tokenomics" },
  { id: "thread-access", title: "Walk me through groups versus roles", day: 18, project: "proj-platform" },
  { id: "thread-glossary", title: "Draft glossary entries for depth and projection", day: 20, project: null },
];

interface SeedTask {
  id: string;
  title: string;
  description: string;
  assignee: string | null;
  status: TaskStatus;
  clearance: string[];
  meeting: string;
  due: number | null;
  day: number;
  project?: string;
}

const TASKS: SeedTask[] = [
  { id: "task-tier-table", title: "Draft the new risk-tier table", description: "Turn the guild decision into a concrete tier table with thresholds and a stated reason per tier.", assignee: ME, status: "done", clearance: ALL, meeting: MEETING_IDS.riskGuild, due: 12, day: 3, project: "proj-risk-framework" },
  { id: "task-clamp-move", title: "Move the leverage clamp out of the scorer", description: "Scoring stays descriptive. The clamp belongs in tiering.", assignee: DEVON, status: "done", clearance: ENG, meeting: MEETING_IDS.riskGuild, due: 14, day: 3, project: "proj-platform" },
  { id: "task-liquidity-inputs", title: "Collect liquidity scenario inputs", description: "Gather depth data for the base, stress, and tail scenarios.", assignee: MARIA, status: "in_progress", clearance: ["all-hands", "research"], meeting: MEETING_IDS.researchSync, due: 18, day: 7, project: "proj-orbit-liquidity" },
  { id: "task-depth-method", title: "Write up the depth sampling method", description: "Reproducible construction rules so a scenario is not a guess with a table around it.", assignee: MARIA, status: "open", clearance: ["research"], meeting: MEETING_IDS.researchSync, due: null, day: 7 },
  { id: "task-onboarding-outline", title: "Outline the contributor handbook", description: "Section headings and owners for the onboarding handbook.", assignee: DEVON, status: "in_progress", clearance: ALL, meeting: MEETING_IDS.standup, due: 18, day: 11, project: "proj-onboarding" },
  { id: "task-kb-cleanup", title: "Clean up stale overview links", description: "Several 00-overview links point at notes that were renamed.", assignee: null, status: "proposed", clearance: ALL, meeting: MEETING_IDS.standup, due: null, day: 11 },
  { id: "task-meeting-notes", title: "File the standup action items", description: "Move this week's standup actions into the tracker.", assignee: null, status: "proposed", clearance: ALL, meeting: MEETING_IDS.standup, due: null, day: 11 },
  { id: "task-emission-model", title: "Sketch the emission schedule options", description: "Two or three emission curves to compare next sprint.", assignee: PRIYA, status: "open", clearance: ["all-hands", "finance"], meeting: MEETING_IDS.tokenomics, due: 24, day: 16, project: "proj-tokenomics" },
  { id: "task-rebate-model", title: "Model rebate and emission interaction", description: "A rebate that outruns emission decay reopens the farming loop.", assignee: PRIYA, status: "open", clearance: ["finance"], meeting: MEETING_IDS.tokenomics, due: null, day: 16 },
  { id: "task-board-update", title: "Draft the Q3 board update", description: "Headline, asks, and the risks we are carrying.", assignee: ME, status: "in_progress", clearance: ["all-hands", "exec"], meeting: MEETING_IDS.execReview, due: 25, day: 18 },
  { id: "task-glossary", title: "Start a glossary section for new terms", description: "Define the terms new contributors keep asking about.", assignee: null, status: "proposed", clearance: ALL, meeting: MEETING_IDS.onboardingRetro, due: null, day: 21 },
  { id: "task-link-handbook", title: "Link the handbook from the overview README", description: "Nobody finds the handbook because nothing points at it.", assignee: DEVON, status: "open", clearance: ALL, meeting: MEETING_IDS.onboardingRetro, due: 26, day: 21, project: "proj-onboarding" },
  { id: "task-stale-rebalance", title: "Reconcile the old rebalance note", description: "Superseded by the tier work. Kept to show a dismissed card.", assignee: null, status: "dismissed", clearance: ALL, meeting: MEETING_IDS.standup, due: null, day: 11 },
];

/** Board-created tasks: `origin = manual`, no source meeting. */
const MANUAL_TASKS: SeedTask[] = [
  { id: "task-manual-ingest-nulls", title: "Enforce the null rule in ingest", description: "A missing component must be null, never zero. Zero silently promotes a thin book.", assignee: ALEX, status: "in_progress", clearance: ENG, meeting: "", due: 27, day: 19, project: "proj-platform" },
  { id: "task-manual-access-audit", title: "Audit group membership after the rollout", description: "Confirm every member landed in the groups the policy note describes.", assignee: ME, status: "open", clearance: ENG, meeting: "", due: null, day: 20, project: "proj-platform" },
];

const PROJECT_DOCS = [
  { id: "pdoc-tier-review", projectId: "proj-risk-framework", filename: "tier-review-notes.md", contentType: "text/markdown", uploader: ME, day: 12, body: "# Tier review notes\n\nRaw notes from the guild review. Tier C ceiling was the only contested number.\n" },
  { id: "pdoc-scenario-inputs", projectId: "proj-orbit-liquidity", filename: "scenario-inputs.txt", contentType: "text/plain", uploader: MARIA, day: 14, body: "base,stress,tail\nplaceholder,placeholder,placeholder\n" },
  { id: "pdoc-handbook-outline", projectId: "proj-onboarding", filename: "handbook-outline.md", contentType: "text/markdown", uploader: DEVON, day: 17, body: "# Handbook outline\n\n1. First week\n2. Conventions\n3. Making your first proposal\n" },
];

export function seedWork(db: DatabaseType): void {
  for (const p of PROJECTS) {
    createProject(db, {
      id: p.id, name: p.name, description: p.description, context: p.context,
      clearance: p.clearance, ownerEmail: ME, createdAt: iso(p.day),
    });
  }

  for (const t of THREADS) {
    recordThread(db, t.id, ME, t.title, iso(t.day, 14));
    // Owner-gated: the seeded threads are all owned by ME, so this attaches.
    if (t.project) attachThread(db, t.project, t.id, ME, ["all-hands", "engineering", "exec", "admins"]);
  }

  for (const t of [...TASKS, ...MANUAL_TASKS]) {
    const manual = t.meeting === "";
    insertProposed(db, {
      id: t.id, title: t.title, description: t.description, assigneeEmail: t.assignee,
      sourceMeetingId: manual ? null : t.meeting,
      sourceNotePath: manual ? null : `meetings/${t.meeting}.md`,
      clearance: t.clearance, due: t.due === null ? null : iso(t.due),
      origin: manual ? "manual" : "circleback", createdAt: iso(t.day),
    });
    // A manual task has a human author, and the author is who may delete it.
    // insertProposed binds created_by NULL by contract, so set it here rather
    // than leaving the seeded manual tasks undeletable by anyone but an admin.
    if (manual) {
      db.prepare(`UPDATE tasks SET created_by = @createdBy WHERE id = @id`)
        .run({ id: t.id, createdBy: t.assignee ?? ME });
    }
    if (t.status !== "proposed") setStatus(db, t.id, t.status);
    // attachTask re-checks visibility AS THE ACTOR, and a task assigned to
    // someone else is not visible to me, so the attach is performed as the
    // assignee (or as me when the task is unassigned).
    if (t.project) {
      const actor = t.assignee ?? ME;
      if (!attachTask(db, t.project, t.id, actor, clearanceOf(actor))) {
        throw new Error(`seed: could not file ${t.id} into ${t.project} as ${actor}`);
      }
    }
  }

  for (const d of PROJECT_DOCS) {
    const bytes = Buffer.from(d.body, "utf8");
    writeProjectDocument({ projectId: d.projectId, id: d.id, filename: d.filename, bytes });
    insertProjectDocument(db, {
      id: d.id, projectId: d.projectId, filename: d.filename, contentType: d.contentType,
      byteSize: bytes.byteLength, uploaderEmail: d.uploader, createdAt: iso(d.day),
    });
  }
}
