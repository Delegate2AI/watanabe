import path from "node:path";
import { parse as parseYaml } from "yaml";

/** One parsed vault doc, ready for the generated INDEX. */
export interface DocEntry {
  path: string;
  title: string;
  description: string;
  tags: string[];
}

const MAX_DESCRIPTION_LEN = 200;

export type FrontmatterRead =
  | { fields: Record<string, unknown>; status: "valid" }
  | { fields: Record<string, never>; status: "unparseable" };

export function readFrontmatter(content: string): FrontmatterRead {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { fields: {}, status: "valid" };
  const closeIndex = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (closeIndex === -1) return { fields: {}, status: "unparseable" };
  try {
    const parsed: unknown = parseYaml(lines.slice(1, closeIndex + 1).join("\n"));
    if (parsed == null) return { fields: {}, status: "valid" };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fields: {}, status: "unparseable" };
    }
    return { fields: parsed as Record<string, unknown>, status: "valid" };
  } catch {
    return { fields: {}, status: "unparseable" };
  }
}

/** Split "key: value" on the first colon, so values may contain their own colons. */
function splitKeyValue(line: string): [string, string] | null {
  const i = line.indexOf(":");
  if (i === -1) return null;
  return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
}

/** Strip one layer of matching surrounding quotes (", ') from a scalar frontmatter value, if present. */
function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' || first === "'") && first === last ? value.slice(1, -1) : value;
}

/** Parse `tags: [a, b]` or `tags: a, b` into a string array. */
function parseInlineTags(value: string): string[] {
  const stripped = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return stripped
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Hand-parse a flat `---\n...\n---` frontmatter block. Returns fields and the remaining body. */
function parseFrontmatter(content: string): { fm: Record<string, string | string[]>; body: string } {
  const fm: Record<string, string | string[]> = {};
  if (!content.startsWith("---")) return { fm, body: content };

  const lines = content.split("\n");
  const closeIndex = lines.slice(1).findIndex((l) => l.trim() === "---");
  if (closeIndex === -1) return { fm, body: content };

  const fmLines = lines.slice(1, closeIndex + 1);
  const body = lines.slice(closeIndex + 2).join("\n");

  let pendingListKey: string | null = null;
  for (const line of fmLines) {
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && pendingListKey) {
      const existing = fm[pendingListKey];
      fm[pendingListKey] = Array.isArray(existing) ? [...existing, listItem[1].trim()] : [listItem[1].trim()];
      continue;
    }
    const kv = splitKeyValue(line);
    if (!kv) continue;
    const [key, value] = kv;
    if (value === "") {
      pendingListKey = key;
      continue;
    }
    pendingListKey = null;
    fm[key] = key === "tags" ? parseInlineTags(value) : stripQuotes(value);
  }

  return { fm, body };
}

/** First `# heading` line in the body, if any. */
function deriveTitleFromBody(body: string): string | null {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/** First non-empty, non-heading line in the body, trimmed and capped. */
function deriveDescriptionFromBody(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed.slice(0, MAX_DESCRIPTION_LEN);
  }
  return "";
}

function titleFromFilename(relPath: string): string {
  return path.basename(relPath, ".md").replace(/[-_]/g, " ");
}

/** Parse a vault doc's frontmatter and derive any missing title/description/tags from its body. */
export function parseDoc(relPath: string, content: string): DocEntry {
  const { fm, body } = parseFrontmatter(content);

  const title = (typeof fm.title === "string" && fm.title) || deriveTitleFromBody(body) || titleFromFilename(relPath);

  const description =
    (typeof fm.description === "string" && fm.description) || deriveDescriptionFromBody(body);

  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  return { path: relPath, title, description, tags };
}
