import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MEETING_NOTES } from "./notes/meetings";
import { OVERVIEW_NOTES } from "./notes/overview";
import { PRODUCT_NOTES } from "./notes/product";
import { TECHNICAL_NOTES } from "./notes/technical";
import type { VaultNote } from "./notes/types";

export function demoVaultRoot(): string {
  return path.resolve(process.cwd(), process.env.DEMO_VAULT_DIR?.trim() || ".data/demo-vault");
}

function yamlValue(value: string | number | string[]): string {
  if (Array.isArray(value)) return `\n${value.map((item) => `  - ${item}`).join("\n")}`;
  return ` ${value}`;
}

function render(note: VaultNote): string {
  if (note.noFrontmatter) return `${note.body.trim()}\n`;
  const fields: Record<string, string | number | string[]> = {
    title: note.title,
    ...(note.extra ?? {}),
    updated: note.updated,
    owner: note.owner,
    ...(note.visibility ? { visibility: note.visibility } : {}),
  };
  const frontmatter = Object.entries(fields)
    .map(([key, value]) => `${key}:${yamlValue(value)}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${note.body.trim()}\n`;
}

export interface VaultSeedResult {
  root: string;
  noteCount: number;
  meetingCount: number;
  /** Note count per clearance group, `all-hands` included. */
  byGroup: Record<string, number>;
}

export function seedVault(): VaultSeedResult {
  const root = demoVaultRoot();
  const vault = path.join(root, "docs");
  // Full rebuild: the vault is generated output, so a stale note from an
  // earlier run would linger in the tree and in every projection.
  rmSync(root, { recursive: true, force: true });

  const notes: VaultNote[] = [...OVERVIEW_NOTES, ...PRODUCT_NOTES, ...TECHNICAL_NOTES, ...MEETING_NOTES];
  const byGroup: Record<string, number> = {};
  for (const note of notes) {
    const file = path.join(vault, note.path);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, render(note));
    for (const group of note.visibility ?? ["all-hands"]) {
      byGroup[group] = (byGroup[group] ?? 0) + 1;
    }
  }

  return { root, noteCount: notes.length, meetingCount: MEETING_NOTES.length, byGroup };
}
