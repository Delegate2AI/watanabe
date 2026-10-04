import type { Database as DatabaseType } from "better-sqlite3";
import { listModelGroups, upsertModelGroup } from "@/lib/db/llm-groups";
import type { ModelGroup } from "./types";

/**
 * What a first key gets when nobody has configured model groups yet (developer
 * decision, 2026-10-04): every model, 5M input plus output tokens a day per
 * person. Without it every model is blocked until an admin acts, so a new key
 * does nothing. Admins edit or replace it in /admin/llm like any other group.
 */
export const DEFAULT_GROUP: ModelGroup = {
  slug: "default",
  label: "All models",
  models: ["*"],
  defaultTokens: 5_000_000,
  period: "day",
};

/**
 * Seeds `DEFAULT_GROUP` only when no group exists at all, so an admin's own
 * groups are never touched. True when it created the group.
 */
export function ensureDefaultGroup(db: DatabaseType): boolean {
  return db.transaction(() => {
    if (listModelGroups(db).length > 0) return false;
    upsertModelGroup(db, DEFAULT_GROUP);
    return true;
  })();
}
