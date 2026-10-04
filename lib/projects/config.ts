import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Spec 26 feature flag. `PROJECTS_ENABLED` gates the whole Projects surface:
 * off, the `/projects` route renders the spec-18 scaffold, the composer's
 * in-project selector is hidden, and no project context is loaded into any
 * agent prompt. Defaults off, so flag-off leaves every existing byte-path
 * identical. Independent of the phase flags (meetings/tasks): projects work with
 * or without them, they just have fewer contents.
 */
export function isProjectsEnabled(): boolean {
  return isFlagEnabled("PROJECTS_ENABLED");
}
