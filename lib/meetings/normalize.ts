import { query } from "@anthropic-ai/claude-agent-sdk";
import { resolveAgentEnv } from "@/lib/agent/auth";
import { captureUsage } from "@/lib/usage/capture";
import type { Meeting } from "./circleback";
import { formatTranscript } from "./transcript-format";

export type Normalizer = (meeting: Meeting) => Promise<string>;

async function runNormalizerAgent(meeting: Meeting): Promise<string> {
  const prompt = [
    "Create concise markdown meeting notes with exactly these headings:",
    "## Summary, ## Decisions, and ## Action items.",
    "Do not add frontmatter or reproduce the full transcript.",
    "Never use em dashes; use a comma, colon, parentheses, or two sentences instead.",
    `Meeting metadata: ${JSON.stringify({ title: meeting.title, startAt: meeting.startAt, attendees: meeting.attendees })}`,
    `Transcript:\n${meeting.transcript.text}`,
  ].join("\n\n");
  let result: string | undefined;
  const stream = query({
    prompt,
    options: {
      model: process.env.AGENT_CHAT_MODEL?.trim() || "claude-opus-4-8",
      tools: [],
      allowedTools: [],
      permissionMode: "default",
      settingSources: [],
      maxTurns: 1,
      env: resolveAgentEnv(),
    },
  });
  for await (const message of stream) {
    if (message.type !== "result") continue;
    captureUsage(message, { source: "meetings", ownerEmail: null, threadId: null });
    if (message.subtype === "success") result = message.result;
  }
  if (!result) throw new Error("meeting normalizer ended without a result");
  return result;
}

/**
 * Deterministic backstop for the repo's mechanical em-dash gate
 * (lib/quality/mechanical.ts): the normalizer is an LLM and the transcript and
 * meeting title come from Circleback, so any of them can carry em dashes that
 * would reject the whole note at write time. Replace them the way the gate
 * suggests (comma), collapsing surrounding spaces.
 */
export function stripEmDashes(text: string): string {
  return text.replace(/ *[\u2014\u2015] */g, ", ");
}

export async function normalizeMeeting(meeting: Meeting, run: Normalizer = runNormalizerAgent): Promise<string> {
  const summary = await run(meeting);
  return stripEmDashes([
    summary.trim(),
    "",
    "## Full transcript",
    "",
    formatTranscript(meeting.transcript.text),
  ].join("\n"));
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function durationMinutes(meeting: Meeting): number | undefined {
  if (!meeting.endAt) return undefined;
  const milliseconds = Date.parse(meeting.endAt) - Date.parse(meeting.startAt);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? Math.round(milliseconds / 60_000) : undefined;
}

export function buildNote(meeting: Meeting, body: string, visibility: string[]): string {
  const duration = durationMinutes(meeting);
  const frontmatter = [
    "---",
    `title: ${yamlString(meeting.title)}`,
    "type: meeting",
    `date: ${yamlString(meeting.startAt)}`,
    ...(duration === undefined ? [] : [`duration_minutes: ${duration}`]),
    "attendees:",
    // Addresses only: this list is the join key for clearance and the people
    // surfaces. An attendee with no address still reaches the normalizer agent
    // through the metadata line above, which carries the whole array.
    ...meeting.attendees
      .filter((attendee): attendee is typeof attendee & { email: string } => Boolean(attendee.email))
      .map((attendee) => `  - ${yamlString(attendee.email)}`),
    `source: ${yamlString(`circleback:${meeting.id}`)}`,
    "visibility:",
    ...visibility.map((group) => `  - ${yamlString(group)}`),
    "---",
  ];
  return stripEmDashes(`${frontmatter.join("\n")}\n\n${body.trim()}\n`);
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "meeting";
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `docs/meetings/<year>/<yyyy-mm-dd-hhmm>-<title>-<id>.md`, UTC. The stamp
 * leads so every surface that lists by path (the vault tree, the agent's
 * kb_list and kb_search, the INDEX) reads a recurring meeting in date order
 * instead of by its opaque ingest id. The id stays as the disambiguator.
 *
 * Only a first ingest names a note: the runner keeps a previously recorded
 * path on re-ingest, and notes written before this stamp keep their old names.
 */
export function slugFor(meeting: Meeting): string {
  const d = new Date(meeting.startAt);
  const year = d.getUTCFullYear();
  const stamp = `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `docs/meetings/${year}/${stamp}-${safeSegment(meeting.title)}-${safeSegment(meeting.id)}.md`;
}
