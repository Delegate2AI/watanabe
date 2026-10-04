import path from "node:path";
import { memoryWorktreeDir } from "@/lib/memory/config";

/**
 * The admin-editable half of the design guidance
 * (docs/superpowers/specs/2026-08-20-html-documents-and-export-design.md).
 *
 * A sibling of flags.yaml / groups.yaml / connectors.yaml on the private access
 * ref, and edited the same way, so every change is an authored commit that
 * already shows up in the Access history and is revertible in git. Markdown
 * rather than YAML because the content is prose the model reads, not config.
 *
 * No flag of its own: the surface is gated on HTML_DOCUMENTS_ENABLED, since a
 * guide for a format the assistant cannot write is nothing to edit.
 */
export const DESIGN_GUIDE_ACCESS_PATH = "access/design-guide.md";

export function designGuideFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "design-guide.md");
}

/**
 * A refusal, not a budget. The guidance the feature ships with is around 3kB,
 * so this leaves an admin room to roughly quintuple it and still bounds what
 * reaches every session's system prompt.
 */
export const MAX_DESIGN_GUIDE_BYTES = 16_000;
