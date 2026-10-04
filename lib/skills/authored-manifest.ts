import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";

export function buildSkillManifest(name: string, description: string, body: string): string {
  const front = [`name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description)}`];
  return `---\n${front.join("\n")}\n---\n\n${body.trimEnd()}\n`;
}

export function manifestRev(manifest: string): string {
  return createHash("sha256").update(manifest, "utf8").digest("hex").slice(0, 12);
}

export type ParsedManifest =
  | { ok: true; name: string; description: string; body: string }
  | { ok: false };

export function parseSkillManifest(raw: string): ParsedManifest {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { ok: false };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { ok: false };

  let front: unknown;
  try {
    front = parseYaml(lines.slice(1, end).join("\n"));
  } catch {
    return { ok: false };
  }
  if (front === null || typeof front !== "object" || Array.isArray(front)) return { ok: false };
  const fields = front as Record<string, unknown>;

  const name = readString(fields.name);
  const description = readString(fields.description);
  if (name === "" || description === "") return { ok: false };

  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "")
    .trimEnd();
  return { ok: true, name, description, body };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
