import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readFrontmatter } from "@/lib/index/frontmatter";
import { noteMetaFromContent } from "@/lib/kb/note";
import { vaultRootFor } from "@/lib/repo";
import { readVisibility } from "@/lib/authority/visibility";

export interface MeetingListItem {
  title: string;
  date: string;
  attendeeCount: number;
  durationMinutes?: number;
  visibility: "all-hands" | "restricted";
  group?: string;
  href: string;
  /** Vault-relative path (e.g. "meetings/2026/foo.md"), the reclearMeeting() notePath. */
  notePath: string;
  /** Full visibility group list (not collapsed), for the admin re-clearance control. */
  visibilityGroups: string[];
  attendees: string[];
}

function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function listMeetingNotes(
  clearance: string[],
  root: string = vaultRootFor(clearance),
): MeetingListItem[] {
  const meetingRoot = path.join(root, "meetings");
  return markdownFiles(meetingRoot)
    .flatMap((file): MeetingListItem[] => {
      const content = readFileSync(file, "utf8");
      const frontmatter = readFrontmatter(content);
      if (frontmatter.fields.type !== "meeting") return [];
      const date = asString(frontmatter.fields.date);
      if (!date) return [];
      const relative = path.relative(root, file).split(path.sep).join("/").replace(/\.md$/i, "");
      const metadata = noteMetaFromContent(`${relative}.md`, content);
      const duration = frontmatter.fields.duration_minutes;
      const visibility = readVisibility(content);
      const attendees = asStrings(frontmatter.fields.attendees);
      return [{
        title: metadata.title,
        date,
        attendeeCount: attendees.length,
        ...(typeof duration === "number" ? { durationMinutes: duration } : {}),
        visibility: metadata.visibility,
        ...(metadata.group ? { group: metadata.group } : {}),
        href: `/kb/${relative}`,
        notePath: `${relative}.md`,
        visibilityGroups: visibility === "unparseable" ? [] : visibility,
        attendees,
      }];
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}
