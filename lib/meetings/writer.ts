import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkAddedLines, type Violation } from "@/lib/quality/mechanical";
import {
  discard,
  ensureWorktree,
  submit,
  worktreeExists,
  worktreeVaultRoot,
} from "@/lib/repo-write";

export interface MeetingWrite {
  meetingId: string;
  path: string;
  content: string;
  title: string;
  authorName: string;
  authorEmail: string;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "meeting";
}

// Exported for direct testing: this is the doctrine-critical allow-list that
// keeps a meeting note contained to docs/meetings/ and rejects traversal.
export function vaultRelativePath(notePath: string): string {
  if (!notePath.startsWith("docs/meetings/") || notePath.includes("\\")) {
    throw new Error("meeting note path must be under docs/meetings/");
  }
  const normalized = path.posix.normalize(notePath);
  if (normalized !== notePath || normalized.includes("..")) {
    throw new Error("meeting note path is unsafe");
  }
  return notePath.slice("docs/".length);
}

/**
 * The subset of the mechanical gates that applies to a meeting note. A note is
 * a RECORD of what attendees said, cited as a whole by its
 * `source: circleback:<id>` frontmatter, and people say things like "$20K"
 * and "two weeks" in meetings, so the uncited-figure and time-estimate prose
 * gates would reject nearly every real meeting. Only the style gate (em dash)
 * is enforced; normalize.ts additionally strips em dashes before writing, so
 * a hit here means that sanitizer regressed.
 */
export function meetingNoteViolations(lines: string[]): Violation[] {
  return checkAddedLines(lines).filter((violation) => violation.kind === "em-dash");
}

export async function writeMeetingNote(input: MeetingWrite): Promise<void> {
  const violations = meetingNoteViolations(input.content.split(/\r?\n/));
  if (violations.length > 0) {
    throw new Error(`meeting note failed mechanical quality gates: ${violations.map((item) => item.message).join("; ")}`);
  }

  const token = process.env.REPO_WRITE_TOKEN?.trim();
  if (!token) throw new Error("REPO_WRITE_TOKEN is required to submit a meeting note");

  const threadId = `meeting-${safeId(input.meetingId)}`;
  if (worktreeExists(threadId)) await discard(threadId);
  await ensureWorktree(threadId);
  const destination = path.join(worktreeVaultRoot(threadId), vaultRelativePath(input.path));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, input.content, "utf8");

  // Spec 20 "Commit mode and bot identity": machine-generated meeting notes
  // commit DIRECTLY to `main` as the bot identity, not one MR per meeting (MRs
  // at meeting cadence would drown human review). This still routes through the
  // per-thread worktree + `submit`, so the write stays fast-forward-only (never
  // forced), rebased onto origin/main, and contained to the docs/meetings/
  // allow-list (`vaultRelativePath` above) with the spec-14 mechanical gates
  // (`checkAddedLines` above). "Direct" skips the review MR, never the guards.
  const result = await submit(threadId, {
    message: `Ingest Circleback meeting: ${input.title}`,
    slug: `meeting-${safeId(input.meetingId).toLowerCase()}`,
    authorName: input.authorName,
    authorEmail: input.authorEmail,
    mode: "direct",
    writeToken: token,
  });
  if (!result.ok) {
    const message = "conflict" in result ? `merge conflict in: ${result.files.join(", ")}` : result.error;
    throw new Error(message);
  }
}
