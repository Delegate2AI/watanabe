import type { Database as DatabaseType } from "better-sqlite3";
import { getThreadModelChoice } from "@/lib/db/threads";
import type { ModelChoiceInput } from "./model-options";

export function freshModelChoiceFor(
  db: DatabaseType,
  threadId: string | undefined,
  requested: ModelChoiceInput,
): ModelChoiceInput | null {
  if (!requested.model && !requested.effort) return null;
  if (!threadId) return requested;
  let stored: { model: string | null; effort: string | null } | null = null;
  try {
    stored = getThreadModelChoice(db, threadId);
  } catch {
    stored = null;
  }
  if (stored?.model) return null;
  return requested;
}
